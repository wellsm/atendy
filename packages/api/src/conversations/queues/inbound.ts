import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { Db } from '../../db';

import { TurnError } from '../../agent/errors';
import { TurnResponder } from '../../agent/turn';
import { isStoreOpen } from '../../stores/hours';
import { EvolutionRequestError } from '../../whatsapp/evolution-client';
import { WhatsAppProviders } from '../../whatsapp/providers';
import { buildClosedReply, CLOSED_REPLY_COOLDOWN_MS, TECHNICAL_ERROR_REPLY } from '../replies';
import { ConversationRepository } from '../repository';
import { ConversationMode, MessageAuthor } from '../types';

export const enum InboundEventKind {
  Customer = 'customer',
  Echo = 'echo'
}

export type InboundEvent = {
  conversationId: string;
  /**
   * Provider message id: FIFO dedupe key.
   */
  eventId: string;
  kind: InboundEventKind;
  /**
   * Stored message id (customer events).
   */
  messageId?: string;
  /**
   * Message text (echo events, which are not stored by the webhook).
   */
  body?: string;
};

/**
 * One group per conversation: turns of the same conversation never run in parallel, and an echo of a
 * bot reply is only handled after the turn that sent it finished (and stored its provider id).
 * The 3s queue delay is the debounce window.
 */
export declare class InboundQueue extends Queue.Ordered<InboundEvent> {
  timeout: 120;

  delay: 3;

  fifoMode: Queue.UseFifoMode<{
    groupId: 'conversationId';
    uniqueId: 'eventId';
  }>;

  deadLetter: Queue.UseDeadLetter<{
    maxAttempts: 3;
  }>;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof handler;
    }>
  ];

  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    OPENROUTER_API_KEY: Environment.Variable<'OPENROUTER_API_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

export async function handler(request: Queue.Incoming<InboundEvent>, { db, variables }: Service.Context<InboundQueue>) {
  const event = request.message;

  const context = await ConversationRepository.loadTurnContext(db, event.conversationId);

  if (!context) {
    return;
  }

  const { conversation, store, customerJid, hours } = context;

  if (event.kind === InboundEventKind.Echo) {
    // Bot replies are stored before this echo is handled (same FIFO group), so an unknown id is either our own
    // send whose id we never learned (pending row with the same text) or staff typing on the phone.
    if (await ConversationRepository.hasMessage(db, { storeId: store.id, providerMessageId: event.eventId })) {
      return;
    }

    const body = event.body ?? '';

    const claimed = await ConversationRepository.claimPendingEcho(db, {
      storeId: store.id,
      conversationId: conversation.id,
      body,
      providerMessageId: event.eventId
    });

    if (claimed) {
      return;
    }

    // Hand off first: if storing the staff message fails, the retry still finds the conversation with a human.
    await ConversationRepository.handOffToHuman(db, {
      conversationId: conversation.id,
      reason: 'staff_replied_from_phone'
    });

    await ConversationRepository.recordOutbound(db, {
      storeId: store.id,
      conversationId: conversation.id,
      author: MessageAuthor.Staff,
      body,
      providerMessageId: event.eventId
    });

    return;
  }

  // Debounce: only the newest inbound message of the conversation runs the turn.
  if ((await ConversationRepository.latestInboundMessageId(db, conversation.id)) !== event.messageId) {
    return;
  }

  const pending = await ConversationRepository.pendingInbound(db, conversation.id);

  if (!pending.length) {
    return;
  }

  const pendingIds = pending.map(({ id }) => id);

  if (conversation.mode === ConversationMode.Human) {
    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  // A previous attempt already replied to this batch (or may have: ambiguous send failure). Never send twice.
  const since = pending[pending.length - 1]!.created_at;

  if (await ConversationRepository.hasBotReplySince(db, { conversationId: conversation.id, since })) {
    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  const provider = WhatsAppProviders.forStore(store, variables);

  const reply = async (text: string) => {
    const pendingId = await ConversationRepository.createPendingOutbound(db, {
      storeId: store.id,
      conversationId: conversation.id,
      body: text
    });

    try {
      const { providerMessageId } = await provider.sendText({ to: customerJid, text });

      await ConversationRepository.confirmOutbound(db, { storeId: store.id, pendingId, providerMessageId });
    } catch (error) {
      // The provider answered with an error: nothing was sent, so the retry may send again.
      if (error instanceof EvolutionRequestError) {
        await ConversationRepository.discardPendingOutbound(db, { storeId: store.id, pendingId });
      }

      throw error;
    }
  };

  if (!store.accepting_orders || !isStoreOpen(hours, store.timezone, new Date())) {
    const text = buildClosedReply({ acceptingOrders: store.accepting_orders, hours });

    const lastSentAt = await ConversationRepository.lastBotReplyAt(db, { conversationId: conversation.id, body: text });

    if (!lastSentAt || Date.now() - Date.parse(lastSentAt) >= CLOSED_REPLY_COOLDOWN_MS) {
      await reply(text);
    }

    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  let turn: { text: string; mutated: boolean };

  try {
    turn = await TurnResponder.respond({
      db,
      env: variables,
      store,
      hours,
      conversationId: conversation.id,
      customerId: conversation.customer_id,
      messages: pending
    });
  } catch (error) {
    // AI failures go back to the queue only while nothing changed and attempts remain; then a human takes over.
    if (!(error instanceof TurnError) || (error.retryable && request.attempt < request.maxAttempts)) {
      throw error;
    }

    await ConversationRepository.handOffToHuman(db, { conversationId: conversation.id, reason: 'technical_error' });

    turn = { text: TECHNICAL_ERROR_REPLY, mutated: false };
  }

  try {
    await reply(turn.text);
  } catch (error) {
    // WhatsApp rejected the reply: a retry would replay the turn and repeat its change, so a human takes over.
    if (!turn.mutated || !(error instanceof EvolutionRequestError)) {
      throw error;
    }

    await ConversationRepository.handOffToHuman(db, { conversationId: conversation.id, reason: 'send_failed' });
  }

  await ConversationRepository.markProcessed(db, pendingIds);
}
