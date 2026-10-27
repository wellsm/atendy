import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object } from '@ez4/schema';
import type { ProspectingProvider } from '../provider';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { isValidSecret } from '../../whatsapp/secret';
import { isProspectingEnabled } from '../enabled';
import { parseProspectingEvent, ProspectingEventKind } from '../events';
import { ProspectingRepository } from '../repository';
import { ProspectPauseReason } from '../types';

export declare class ProspectingWebhookRequest implements Http.Request {
  headers: {
    authorization?: string;
  };
  /**
   * Any JSON object: a typed body would make the gateway strip unknown Evolution fields.
   */
  body: Object.Any;
}

export declare class ProspectingWebhookResponse implements Http.Response {
  status: 200;
}

/**
 * Evolution calls this for the prospecting instance: replies, delivery acks and connection changes. Never log headers
 * or body, and nothing here reaches store conversations or the inbound queue.
 */
export async function prospectingWebhookHandler(
  request: Http.Incoming<ProspectingWebhookRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<ProspectingWebhookResponse> {
  // Off: acknowledge without reading anything, so Evolution stops retrying.
  if (!isProspectingEnabled()) {
    return { status: 200 };
  }

  const sender = await ProspectingRepository.getSender(db);

  if (!isValidSecret(sender.webhookSecret, request.headers.authorization)) {
    throw new HttpUnauthorizedError();
  }

  const event = parseProspectingEvent(request.body);

  if (event.kind === ProspectingEventKind.Ignored) {
    return { status: 200 };
  }

  if (event.instance !== sender.instance) {
    throw new HttpUnauthorizedError();
  }

  switch (event.kind) {
    case ProspectingEventKind.Inbound:
      await ProspectingRepository.markReplied(db, event.phone, event.at);
      break;
    case ProspectingEventKind.Ack:
      await ProspectingRepository.markAck(db, event.providerMessageId, event.status, new Date());
      break;
    case ProspectingEventKind.Connection:
      if (event.open === true) {
        await ProspectingRepository.setSenderState(db, { connected: true });
      } else if (event.open === false) {
        await ProspectingRepository.setSenderState(db, {
          connected: false,
          paused: true,
          pauseReason: ProspectPauseReason.Disconnected
        });
      }
      break;
  }

  return { status: 200 };
}
