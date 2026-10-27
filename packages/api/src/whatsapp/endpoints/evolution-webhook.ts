import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object, String } from '@ez4/schema';
import type { WebhookProvider } from '../provider';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { phoneVariants } from '../../storefront/web-order';
import { parseEvolutionEvent } from '../evolution-parser';
import { formatReactionBody, isAnswerReaction } from '../reaction';
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

const isStockAlertPhone = (alertPhone: string | null | undefined, phone: string | undefined) =>
  !!alertPhone && !!phone && phoneVariants(alertPhone).includes(phone);

/**
 * Evolution calls this for every instance event. Never log headers or body: they carry the secret and
 * customer data.
 */
export async function evolutionWebhookHandler(
  request: Http.Incoming<EvolutionWebhookRequest>,
  { db, inboundQueue, panelEvents }: Service.Context<WebhookProvider>
): Promise<EvolutionWebhookResponse> {
  const { storeId } = request.parameters;

  const store = await db.stores.findOne({
    select: {
      whatsapp_webhook_secret: true,
      whatsapp_instance: true,
      active: true,
      billing_blocked: true,
      stock_alert_phone: true
    },
    where: { id: storeId }
  });

  if (!store || !isValidSecret(store.whatsapp_webhook_secret, request.headers.authorization)) {
    throw new HttpUnauthorizedError();
  }

  // Inactive (not yet approved or suspended by the admin) or blocked by an unpaid invoice: drop before storing or
  // queueing, so no AI is spent.
  if (!store.active || store.billing_blocked) {
    return { status: 200 };
  }

  const event = parseEvolutionEvent(request.body);

  if (event.kind === ParsedEventKind.Ignored) {
    return { status: 200 };
  }

  if (event.instance !== store.whatsapp_instance) {
    throw new HttpUnauthorizedError();
  }

  if (event.kind === ParsedEventKind.Reaction) {
    // The store's own reactions (from the phone) are not tracked.
    if (event.fromMe) {
      return { status: 200 };
    }

    const applied = await ConversationRepository.applyReaction(db, { storeId, ...event });

    if (applied) {
      await notifyPanel(panelEvents, storeId, [PanelTrigger.Conversations], applied.reacted.conversation_id);
    }

    // Only a reaction that answers the bot's latest question becomes a message for the bot.
    if (!applied || !isAnswerReaction({ emoji: event.emoji, ...applied })) {
      return { status: 200 };
    }

    const ingested = await ConversationRepository.ingestCustomerMessage(db, {
      storeId,
      message: {
        kind: ParsedEventKind.Message,
        instance: event.instance,
        providerMessageId: event.providerMessageId,
        fromMe: false,
        jid: event.jid,
        phone: event.phone,
        pushName: event.pushName,
        text: formatReactionBody(event.emoji, applied.reacted.body),
        sentAt: event.sentAt
      }
    });

    await notifyPanel(panelEvents, storeId, [PanelTrigger.Conversations], ingested.conversationId);

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

  // The daily stock digest goes out from the store's own instance: its echo must never reach a conversation.
  if (event.fromMe && isStockAlertPhone(store.stock_alert_phone, event.phone)) {
    return { status: 200 };
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

  await notifyPanel(panelEvents, storeId, [PanelTrigger.Conversations], ingested.conversationId);

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
