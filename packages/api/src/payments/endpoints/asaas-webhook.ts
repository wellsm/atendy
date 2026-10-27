import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object } from '@ez4/schema';
import type { PaymentsProvider } from '../provider';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { isValidSecret } from '../../whatsapp/secret';
import { PaymentsRepository } from '../repository';

export declare class AsaasWebhookRequest implements Http.Request {
  headers: {
    'asaas-access-token'?: string;
  };
  /**
   * Any JSON object: a typed body would make the gateway strip unknown Asaas fields.
   */
  body: Object.Any;
}

export declare class AsaasWebhookResponse implements Http.Response {
  status: 200;
}

/**
 * Asaas payment events (token set in the Asaas webhook settings). Always 200 for events we do not track, or Asaas
 * pauses the webhook queue. Never log headers or body.
 */
export async function asaasWebhookHandler(
  request: Http.Incoming<AsaasWebhookRequest>,
  { db }: Service.Context<PaymentsProvider>
): Promise<AsaasWebhookResponse> {
  if (!isValidSecret(process.env.ASAAS_WEBHOOK_TOKEN ?? '', request.headers['asaas-access-token'])) {
    throw new HttpUnauthorizedError();
  }

  const { event, payment } = request.body as { event?: unknown; payment?: { id?: unknown; invoiceUrl?: unknown } };

  if (typeof event !== 'string' || typeof payment?.id !== 'string') {
    return { status: 200 };
  }

  await PaymentsRepository.applyWebhook(db, {
    event,
    paymentId: payment.id,
    invoiceUrl: typeof payment.invoiceUrl === 'string' ? payment.invoiceUrl : null,
    now: new Date()
  });

  return { status: 200 };
}
