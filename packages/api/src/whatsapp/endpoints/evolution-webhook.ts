import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object, String } from '@ez4/schema';
import type { WebhookProvider } from '../provider';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { parseEvolutionEvent } from '../evolution-parser';
import { isValidSecret } from '../secret';
import { ParsedEventKind } from '../types';

export declare class EvolutionWebhookRequest implements Http.Request {
  parameters: {
    storeId: String.UUID;
  };
  headers: {
    authorization?: string;
  };
  /**
   * Any JSON object: a typed body would make the gateway strip unknown Evolution fields.
   */
  body: Object.Any;
}

export declare class EvolutionWebhookResponse implements Http.Response {
  status: 200;
}

/**
 * Evolution calls this for every instance event. Never log headers or body: they carry the secret and
 * customer data.
 */
export async function evolutionWebhookHandler(
  request: Http.Incoming<EvolutionWebhookRequest>,
  { db, inboundQueue }: Service.Context<WebhookProvider>
): Promise<EvolutionWebhookResponse> {
  const { storeId } = request.parameters;

  const store = await db.stores.findOne({
    select: { whatsapp_webhook_secret: true, whatsapp_instance: true, active: true },
    where: { id: storeId }
  });

  if (!store || !isValidSecret(store.whatsapp_webhook_secret, request.headers.authorization)) {
    throw new HttpUnauthorizedError();
  }

  // Inactive (not yet approved or suspended by the admin): drop before storing or queueing, so no AI is spent.
  if (!store.active) {
    return { status: 200 };
  }

  const event = parseEvolutionEvent(request.body);

  if (event.kind === ParsedEventKind.Ignored) {
    return { status: 200 };
  }

  if (event.instance !== store.whatsapp_instance) {
    throw new HttpUnauthorizedError();
  }

  if (event.fromMe) {
    const conversationId = await ConversationRepository.findConversation(db, {
      storeId,
      phone: event.phone,
      jid: event.jid
    });

    if (conversationId) {
      await inboundQueue.sendMessage({
        conversationId,
        eventId: event.providerMessageId,
        kind: InboundEventKind.Echo,
        body: event.text
      });
    }

    return { status: 200 };
  }

  const ingested = await ConversationRepository.ingestCustomerMessage(db, { storeId, message: event });

  if (!ingested.processed) {
    await inboundQueue.sendMessage({
      conversationId: ingested.conversationId,
      eventId: event.providerMessageId,
      kind: InboundEventKind.Customer,
      messageId: ingested.messageId
    });
  }

  return { status: 200 };
}
