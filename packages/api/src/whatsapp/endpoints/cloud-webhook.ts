import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object } from '@ez4/schema';
import type { OtpDeliveryStatus } from '../../storefront/phone-code';
import type { CloudWebhookProvider } from '../provider';

import { createHmac } from 'node:crypto';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';

import { recordOtpDeliveries } from '../../storefront/phone-code';
import { isValidSecret } from '../secret';

export declare class VerifyCloudWebhookRequest implements Http.Request {
  query: {
    'hub.mode'?: string;
    'hub.verify_token'?: string;
    'hub.challenge'?: string;
  };
}

export declare class VerifyCloudWebhookResponse implements Http.Response {
  status: 200;
  body: string;
}

/**
 * Meta checks the callback URL once (Webhook settings): echo the challenge when the verify token matches.
 */
export function verifyWhatsAppCloudWebhookHandler(
  request: Http.Incoming<VerifyCloudWebhookRequest>,
  // Only links the provider: its variables are this Lambda's env (no database).
  _context: Service.Context<CloudWebhookProvider>
): VerifyCloudWebhookResponse {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = request.query;

  if (mode !== 'subscribe' || !isValidSecret(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '', token)) {
    throw new HttpForbiddenError();
  }

  return { status: 200, body: challenge ?? '' };
}

export declare class CloudWebhookRequest implements Http.Request {
  headers: {
    'x-hub-signature-256'?: string;
  };
  /**
   * Any JSON object: a typed body would make the gateway strip unknown Meta fields.
   */
  body: Object.Any;
}

export declare class CloudWebhookResponse implements Http.Response {
  status: 200;
}

type MetaStatus = {
  id?: unknown;
  status?: unknown;
  errors?: { code?: unknown; title?: unknown; error_data?: { details?: unknown } }[];
};

type MetaWebhook = { entry?: { changes?: { value?: { statuses?: MetaStatus[] } }[] }[] };

/**
 * Events of Atendy's own WhatsApp Cloud API number (not the stores' Evolution numbers), signed by Meta with the app
 * secret over the raw body. Today only delivery statuses of the web order codes are used. Always 200 for anything else (Meta retries and then disables failing webhooks). Never log headers or body.
 */
export async function whatsAppCloudWebhookHandler(
  request: Http.Incoming<CloudWebhookRequest>,
  { db }: Service.Context<CloudWebhookProvider>
): Promise<CloudWebhookResponse> {
  const raw = request.encoded ? Buffer.from(request.data ?? '', 'base64').toString() : (request.data ?? '');
  const expected = `sha256=${createHmac('sha256', process.env.WHATSAPP_APP_SECRET ?? '')
    .update(raw)
    .digest('hex')}`;

  if (!process.env.WHATSAPP_APP_SECRET || !isValidSecret(expected, request.headers['x-hub-signature-256'])) {
    throw new HttpUnauthorizedError();
  }

  const statuses = ((request.body as MetaWebhook).entry ?? [])
    .flatMap(({ changes }) => changes ?? [])
    .flatMap(({ value }) => value?.statuses ?? [])
    .flatMap(({ id, status, errors }): OtpDeliveryStatus[] => {
      if (typeof id !== 'string' || typeof status !== 'string') {
        return [];
      }

      const [first] = errors ?? [];
      const detail = first?.error_data?.details ?? first?.title;

      return [{ id, status, error: first ? [first.code, detail].filter(Boolean).join(' ') : null }];
    });

  await recordOtpDeliveries(db, statuses);

  return { status: 200 };
}
