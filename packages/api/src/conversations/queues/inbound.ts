import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { Db } from '../../db';
import type { SimulationQueue } from '../../simulations/queues/step';
import type { VoiceNotes } from '../../storage';

import { notifyAdmin } from '../../admin/telegram';
import { TurnError } from '../../agent/errors';
import { transcribeVoiceNotes } from '../../agent/transcription';
import { TurnResponder } from '../../agent/turn';
import { OrderRepository } from '../../orders/repository';
import { SimulatorProvider } from '../../simulations/provider';
import { isSimulatedJid, SimulationRepository } from '../../simulations/repository';
import { storefrontUrl } from '../../storefront/url';
import { isStoreOpen } from '../../stores/hours';
import { orderMemorySince } from '../../stores/policy';
import { EvolutionRequestError } from '../../whatsapp/evolution-client';
import { parseLocationBody } from '../../whatsapp/location';
import { isMediaOnly, MEDIA_ONLY_REPLY } from '../../whatsapp/media';
import { WhatsAppProviders } from '../../whatsapp/providers';
import { buildGreeting, firstName, greetingPeriod, isGreetingOnly } from '../greeting';
import { buildClosedReply, CLOSED_REPLY_COOLDOWN_MS, splitMessages, TECHNICAL_ERROR_REPLY } from '../replies';
import { ConversationRepository } from '../repository';
import { ConversationMode, MessageAuthor } from '../types';
import { saveVoiceNotes } from '../voice-notes';

/**
 * "digitando…" before each message after the first of a reply (Evolution's `delay`).
 */
const NEXT_MESSAGE_DELAY_MS = 1200;

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
    /**
     * Stores on a direct Anthropic model (`anthropic-direct/...` in `LLM_MODELS`).
     */
    ANTHROPIC_API_KEY: Environment.Variable<'ANTHROPIC_API_KEY'>;
    GOOGLE_MAPS_API_KEY: Environment.Variable<'GOOGLE_MAPS_API_KEY'>;
    /**
     * Admin alert when a turn ends in a technical handoff (`notifyAdmin`).
     */
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
    /**
     * Web app origin (no trailing slash): the bot sends `<WEB_BASE_URL>/<slug>` when asked for the menu.
     */
    WEB_BASE_URL: Environment.Variable<'WEB_BASE_URL'>;
  };

  services: {
    db: Environment.Service<Db>;
    simulationQueue: Environment.Service<SimulationQueue>;
    voiceNotes: Environment.Service<VoiceNotes>;
    variables: Environment.ServiceVariables;
  };
}

export async function handler(
  request: Queue.Incoming<InboundEvent>,
  { db, simulationQueue, voiceNotes, variables }: Service.Context<InboundQueue>
) {
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

  const pendingRows = await ConversationRepository.pendingInbound(db, conversation.id);

  if (!pendingRows.length) {
    return;
  }

  const pendingIds = pendingRows.map(({ id }) => id);

  // Simulated customers (admin scenario runs) never reach WhatsApp.
  const provider = isSimulatedJid(customerJid)
    ? await SimulatorProvider.forConversation(db, conversation.id)
    : WhatsAppProviders.forStore(store, variables);

  // Voice notes are kept for the panel in any mode; the bot transcribes them below.
  const pending = await saveVoiceNotes(db, { storeId: store.id, bucket: voiceNotes, provider, messages: pendingRows });

  if (conversation.mode === ConversationMode.Human) {
    // A person may be building the order in the panel: a shared location still goes to it (distance delivery).
    const pin = pending
      .map(({ body }) => parseLocationBody(body))
      .filter((location) => location !== undefined)
      .at(-1);

    if (pin) {
      await OrderRepository.setLocation(
        db,
        { storeId: store.id, conversationId: conversation.id, customerId: conversation.customer_id },
        pin
      );
    }

    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  // Waiting for the store's approval: the messages stay pending and the bot answers them all once approved.
  if (conversation.approval_reason) {
    return;
  }

  // A previous attempt already replied to this batch (or may have: ambiguous send failure). Never send twice.
  const since = pending[pending.length - 1]!.created_at;

  if (await ConversationRepository.hasBotReplySince(db, { conversationId: conversation.id, since })) {
    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  // The simulated customer answers once the whole reply is stored (or when the bot stops, waiting for the store).
  const queueSimulationStep = async () => {
    const simulationId = await SimulationRepository.findIdByConversation(db, conversation.id);

    if (simulationId) {
      await simulationQueue.sendMessage({ simulationId });
    }
  };

  // Each text is its own WhatsApp message; the ones after the first show "digitando…" before going out.
  const reply = async (texts: string[]) => {
    for (const [index, text] of texts.entries()) {
      const pendingId = await ConversationRepository.createPendingOutbound(db, {
        storeId: store.id,
        conversationId: conversation.id,
        body: text
      });

      try {
        const { providerMessageId } = await provider.sendText({
          to: customerJid,
          text,
          ...(index > 0 && { delayMs: NEXT_MESSAGE_DELAY_MS })
        });

        await ConversationRepository.confirmOutbound(db, { storeId: store.id, pendingId, providerMessageId });
      } catch (error) {
        // The provider answered with an error: nothing was sent, so the retry may send again.
        if (error instanceof EvolutionRequestError) {
          await ConversationRepository.discardPendingOutbound(db, { storeId: store.id, pendingId });
        }

        throw error;
      }
    }

    if (isSimulatedJid(customerJid)) {
      await queueSimulationStep();
    }
  };

  if (!store.accepting_orders || !isStoreOpen(hours, store.timezone, new Date())) {
    const text = buildClosedReply({ acceptingOrders: store.accepting_orders, hours });

    const lastSentAt = await ConversationRepository.lastBotReplyAt(db, { conversationId: conversation.id, body: text });

    if (!lastSentAt || Date.now() - Date.parse(lastSentAt) >= CLOSED_REPLY_COOLDOWN_MS) {
      await reply([text]);
    }

    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  // Voice notes become text the model reads; the ones that fail stay media.
  const messages = await transcribeVoiceNotes(db, {
    storeId: store.id,
    conversationId: conversation.id,
    apiKey: variables.OPENROUTER_API_KEY,
    bucket: voiceNotes,
    messages: pending
  });

  const menuUrl = storefrontUrl(variables.WEB_BASE_URL, store.slug);

  // First message of an order cycle: the store's fixed greeting goes out with the reply, after the model ran (a retried
  // turn never leaves a greeting that would count as the answer).
  const now = new Date();
  const lastActivity = await ConversationRepository.lastActivityBefore(db, conversation.id, pendingIds);
  const firstContact = !lastActivity || Date.parse(lastActivity) < Date.parse(orderMemorySince(store.policy, now));
  const customer = firstContact
    ? await ConversationRepository.greetingCustomer(db, conversation.customer_id)
    : undefined;

  // A new customer who only said hello gets the full welcome (menu link included) and no model reply.
  const standalone = !!customer?.newCustomer && isGreetingOnly(messages.map(({ body }) => body));

  let greeting = customer
    ? buildGreeting({
        period: greetingPeriod(store.timezone, now),
        name: firstName(customer.name),
        storeName: store.name,
        menuUrl,
        newCustomer: customer.newCustomer,
        standalone
      })
    : [];

  // Only media the bot cannot open: a fixed answer, no model call.
  if (messages.every(({ body }) => isMediaOnly(body))) {
    await reply([...greeting, MEDIA_ONLY_REPLY]);
    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  if (standalone) {
    await reply(greeting);
    await ConversationRepository.markProcessed(db, pendingIds);
    return;
  }

  let turn: { text: string; mutated: boolean; awaitingApproval?: boolean };

  // Only the model turn takes seconds: the customer sees "digitando…" meanwhile.
  const stopTyping = provider.startTyping({ to: customerJid });

  try {
    turn = await TurnResponder.respond({
      db,
      env: variables,
      store,
      hours,
      conversationId: conversation.id,
      customerId: conversation.customer_id,
      messages,
      menuUrl,
      approvedReason: conversation.approved_reason,
      greeted: greeting.length > 0
    });
  } catch (error) {
    // AI failures go back to the queue only while nothing changed and attempts remain; then a human takes over.
    if (!(error instanceof TurnError) || (error.retryable && request.attempt < request.maxAttempts)) {
      throw error;
    }

    await ConversationRepository.handOffToHuman(db, { conversationId: conversation.id, reason: 'technical_error' });

    // This path does not throw, so nothing else would record why (the message never has customer text).
    await notifyAdmin(
      `Atendy: erro técnico, conversa passada a atendente.\nLoja: ${store.slug}\nConversa: ${conversation.id}\nTentativa: ${request.attempt}/${request.maxAttempts}\nErro: ${error.message}`
    );

    turn = { text: TECHNICAL_ERROR_REPLY, mutated: false };
    greeting = [];
  } finally {
    await stopTyping();
  }

  // The store decides first: nothing goes to the customer and the batch stays pending for the approved turn. A
  // simulated customer would wait for a reply forever: its step runs now and ends the run like a handoff.
  if (turn.awaitingApproval) {
    if (isSimulatedJid(customerJid)) {
      await queueSimulationStep();
    }

    return;
  }

  try {
    await reply([...greeting, ...splitMessages(turn.text)]);
  } catch (error) {
    // WhatsApp rejected the reply: a retry would replay the turn and repeat its change, so a human takes over.
    if (!turn.mutated || !(error instanceof EvolutionRequestError)) {
      throw error;
    }

    await ConversationRepository.handOffToHuman(db, { conversationId: conversation.id, reason: 'send_failed' });
  }

  await ConversationRepository.markProcessed(db, pendingIds);
}
