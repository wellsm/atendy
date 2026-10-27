import type { DbClient } from '../db';
import type { HourRange } from '../stores/hours';
import type { ParsedMessage } from '../whatsapp/types';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';
import { DuplicateUniqueKeyError } from '@ez4/pgclient';

import { ConversationMode, MessageAuthor, MessageDirection } from './types';
import { BillingRepository } from '../billing/repository';
import { OrderStatus } from '../orders/types';

/**
 * Orders that reached the store (a customer with none is new to it).
 */
const PLACED_STATUSES = [
  OrderStatus.Placed,
  OrderStatus.Accepted,
  OrderStatus.Out,
  OrderStatus.Done,
  OrderStatus.Canceled
];

export namespace ConversationRepository {
  /**
   * Upsert customer + conversation and store the inbound message. A redelivered provider message id is not
   * stored again; `processed` tells whether it still needs a turn (its first enqueue may have failed).
   */
  export const ingestCustomerMessage = async (db: DbClient, input: { storeId: string; message: ParsedMessage }) => {
    const { storeId, message } = input;
    const now = new Date().toISOString();

    const { record: customer } = await db.customers.upsertOne({
      select: { id: true },
      insert: {
        id: randomUUID(),
        store_id: storeId,
        phone: message.phone,
        whatsapp_jid: message.jid,
        name: message.pushName ?? null,
        created_at: now,
        updated_at: now
      },
      update: {
        whatsapp_jid: message.jid,
        updated_at: now
      },
      where: { store_id: storeId, phone: message.phone }
    });

    const { record: conversation } = await db.conversations.upsertOne({
      select: { id: true },
      insert: {
        id: randomUUID(),
        store_id: storeId,
        customer_id: customer.id,
        mode: ConversationMode.Bot,
        last_message_at: now,
        created_at: now
      },
      update: {
        last_message_at: now
      },
      where: { store_id: storeId, customer_id: customer.id }
    });

    const messageId = randomUUID();

    try {
      await db.messages.insertOne({
        data: {
          id: messageId,
          store_id: storeId,
          conversation_id: conversation.id,
          direction: MessageDirection.In,
          author: MessageAuthor.Customer,
          body: message.text,
          provider_message_id: message.providerMessageId,
          voice_note: message.voiceNote ?? null,
          created_at: now
        }
      });
    } catch (error) {
      if (!(error instanceof DuplicateUniqueKeyError)) {
        throw error;
      }

      const existing = await db.messages.findOne({
        select: { id: true, conversation_id: true, processed_at: true },
        where: { store_id: storeId, provider_message_id: message.providerMessageId }
      });

      if (!existing) {
        throw error;
      }

      return { conversationId: existing.conversation_id, messageId: existing.id, processed: !!existing.processed_at };
    }

    return { conversationId: conversation.id, messageId, processed: false };
  };

  /**
   * Conversation of a contact, by phone first (stable) then by reply JID (`@lid` contacts may switch address).
   */
  export const findConversation = async (db: DbClient, input: { storeId: string; phone: string; jid: string }) => {
    const byPhone = await db.customers.findOne({
      select: { id: true },
      where: { store_id: input.storeId, phone: input.phone }
    });

    const {
      records: [byJid]
    } = byPhone
      ? { records: [byPhone] }
      : await db.customers.findMany({
          select: { id: true },
          where: { store_id: input.storeId, whatsapp_jid: input.jid },
          take: 1
        });

    if (!byJid) {
      return undefined;
    }

    const conversation = await db.conversations.findOne({
      select: { id: true },
      where: { store_id: input.storeId, customer_id: byJid.id }
    });

    return conversation?.id;
  };

  export const loadTurnContext = async (db: DbClient, conversationId: string) => {
    const conversation = await db.conversations.findOne({
      select: {
        id: true,
        store_id: true,
        mode: true,
        customer_id: true,
        approval_reason: true,
        approved_reason: true
      },
      where: { id: conversationId }
    });

    if (!conversation) {
      return undefined;
    }

    const [store, customer, { records: hours }] = await Promise.all([
      db.stores.findOne({
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          accepting_orders: true,
          router: true,
          llm_model: true,
          payment_methods: true,
          delivery_mode: true,
          flat_fee_cents: true,
          policy: true,
          whatsapp_provider: true,
          whatsapp_instance: true,
          whatsapp_instance_token: true
        },
        where: { id: conversation.store_id }
      }),
      db.customers.findOne({ select: { whatsapp_jid: true }, where: { id: conversation.customer_id } }),
      db.store_hours.findMany({
        select: { weekday: true, opens_at: true, closes_at: true },
        where: { store_id: conversation.store_id }
      })
    ]);

    if (!store || !customer) {
      return undefined;
    }

    return { conversation, store, customerJid: customer.whatsapp_jid, hours: hours as HourRange[] };
  };

  export const latestInboundMessageId = async (db: DbClient, conversationId: string) => {
    const { records } = await db.messages.findMany({
      select: { id: true },
      where: { conversation_id: conversationId, direction: MessageDirection.In },
      order: { created_at: Order.Desc },
      take: 1
    });

    return records[0]?.id;
  };

  export const pendingInbound = async (db: DbClient, conversationId: string) => {
    const { records } = await db.messages.findMany({
      select: { id: true, body: true, voice_note: true, audio_key: true, created_at: true },
      where: { conversation_id: conversationId, direction: MessageDirection.In, processed_at: null },
      order: { created_at: Order.Asc }
    });

    return records;
  };

  /**
   * Last messages of the conversation (oldest first), without the ones the current turn answers.
   */
  export const recentMessages = async (
    db: DbClient,
    input: { conversationId: string; limit: number; excludeIds: string[]; since: string }
  ) => {
    const { records } = await db.messages.findMany({
      select: { id: true, author: true, body: true },
      where: { conversation_id: input.conversationId, created_at: { gte: input.since } },
      order: { created_at: Order.Desc },
      take: input.limit + input.excludeIds.length
    });

    return records
      .filter(({ id }) => !input.excludeIds.includes(id))
      .slice(0, input.limit)
      .reverse()
      .map(({ author, body }) => ({ author, body }));
  };

  /**
   * Time of the conversation's newest message outside `excludeIds` (the batch being answered): when the customer was
   * last active before coming back.
   */
  export const lastActivityBefore = async (db: DbClient, conversationId: string, excludeIds: string[]) => {
    const { records } = await db.messages.findMany({
      select: { id: true, created_at: true },
      where: { conversation_id: conversationId },
      order: { created_at: Order.Desc },
      take: excludeIds.length + 1
    });

    return records.find(({ id }) => !excludeIds.includes(id))?.created_at;
  };

  /**
   * Who the greeting talks to: the WhatsApp name and whether the customer never placed an order in the store.
   */
  export const greetingCustomer = async (db: DbClient, customerId: string) => {
    const [customer, placed] = await Promise.all([
      db.customers.findOne({ select: { name: true }, where: { id: customerId } }),
      db.orders.count({ where: { customer_id: customerId, status: { isIn: PLACED_STATUSES } } })
    ]);

    return { name: customer?.name ?? null, newCustomer: !placed };
  };

  export const markProcessed = async (db: DbClient, ids: string[]) => {
    if (!ids.length) {
      return;
    }

    await db.messages.updateMany({
      data: { processed_at: new Date().toISOString() },
      where: { id: { isIn: ids } }
    });
  };

  export const recordOutbound = async (
    db: DbClient,
    input: { storeId: string; conversationId: string; author: MessageAuthor; body: string; providerMessageId: string }
  ) => {
    const now = new Date().toISOString();

    await db.messages.insertOne({
      data: {
        id: randomUUID(),
        store_id: input.storeId,
        conversation_id: input.conversationId,
        direction: MessageDirection.Out,
        author: input.author,
        body: input.body,
        provider_message_id: input.providerMessageId,
        processed_at: now,
        created_at: now
      }
    });
  };

  /**
   * Puts the customer's reaction on the reacted message of their conversation (null when removed). Returns the reacted
   * message and whether it is the conversation's latest outbound one; undefined when either is unknown.
   */
  export const applyReaction = async (
    db: DbClient,
    input: { storeId: string; phone: string; jid: string; reactedId: string; emoji: string }
  ) => {
    const conversationId = await findConversation(db, input);

    if (!conversationId) {
      return undefined;
    }

    const reacted = await db.messages.findOne({
      select: { id: true, conversation_id: true, direction: true, author: true, body: true },
      where: { store_id: input.storeId, provider_message_id: input.reactedId }
    });

    if (reacted?.conversation_id !== conversationId) {
      return undefined;
    }

    await db.messages.updateOne({ data: { reaction: input.emoji || null }, where: { id: reacted.id } });

    const {
      records: [latest]
    } = await db.messages.findMany({
      select: { id: true },
      where: { conversation_id: conversationId, direction: MessageDirection.Out },
      order: { created_at: Order.Desc },
      take: 1
    });

    return { reacted, latestOutboundId: latest?.id };
  };

  export const hasMessage = async (db: DbClient, input: { storeId: string; providerMessageId: string }) => {
    const count = await db.messages.count({
      where: { store_id: input.storeId, provider_message_id: input.providerMessageId }
    });

    return count > 0;
  };

  /**
   * The bot answered in the current order cycle (since the last placed order): a handoff without it means the store
   * served the customer alone.
   */
  const botServed = async (db: DbClient, conversationId: string) => {
    const { records: placed } = await db.orders.findMany({
      select: { placed_at: true },
      where: { conversation_id: conversationId, placed_at: { isNull: false } },
      order: { placed_at: Order.Desc },
      take: 1
    });

    const since = placed[0]?.placed_at;

    const replies = await db.messages.count({
      where: {
        conversation_id: conversationId,
        author: MessageAuthor.Bot,
        ...(since && { created_at: { gt: since } })
      }
    });

    return replies > 0;
  };

  /**
   * Every way to a person goes here or through `setMode(Human)`: both bill what the AI finished so far.
   */
  export const handOffToHuman = async (db: DbClient, input: { conversationId: string; reason: string }) => {
    await db.conversations.updateOne({
      data: { mode: ConversationMode.Human, handoff_reason: input.reason, approval_reason: null },
      where: { id: input.conversationId }
    });

    await BillingRepository.recordHandoff(db, { ...input, botServed: await botServed(db, input.conversationId) });
  };

  export const lastBotReplyAt = async (db: DbClient, input: { conversationId: string; body: string }) => {
    const { records } = await db.messages.findMany({
      select: { created_at: true },
      where: { conversation_id: input.conversationId, author: MessageAuthor.Bot, body: input.body },
      order: { created_at: Order.Desc },
      take: 1
    });

    return records[0]?.created_at;
  };

  const PENDING_PREFIX = 'pending:';

  /**
   * Store the bot reply before sending, so a retry after an ambiguous failure (timeout) does not send twice
   * and the echo of that send is recognised as ours. Returns the row id.
   */
  export const createPendingOutbound = async (
    db: DbClient,
    input: { storeId: string; conversationId: string; body: string; author?: MessageAuthor }
  ) => {
    const id = randomUUID();

    await recordOutbound(db, {
      storeId: input.storeId,
      conversationId: input.conversationId,
      author: input.author ?? MessageAuthor.Bot,
      body: input.body,
      providerMessageId: `${PENDING_PREFIX}${id}`
    });

    return id;
  };

  export const confirmOutbound = async (
    db: DbClient,
    input: { storeId: string; pendingId: string; providerMessageId: string }
  ) => {
    await db.messages.updateMany({
      data: { provider_message_id: input.providerMessageId },
      where: { store_id: input.storeId, provider_message_id: `${PENDING_PREFIX}${input.pendingId}` }
    });
  };

  export const discardPendingOutbound = async (db: DbClient, input: { storeId: string; pendingId: string }) => {
    await db.messages.deleteMany({
      where: { store_id: input.storeId, provider_message_id: `${PENDING_PREFIX}${input.pendingId}` }
    });
  };

  export const hasBotReplySince = async (db: DbClient, input: { conversationId: string; since: string }) => {
    const count = await db.messages.count({
      where: { conversation_id: input.conversationId, author: MessageAuthor.Bot, created_at: { gte: input.since } }
    });

    return count > 0;
  };

  /**
   * An echo with an unknown id may be our own send whose id we never learned (ambiguous failure, or a panel send
   * not confirmed yet). Claims the oldest pending row (bot or staff) with the same text. Returns whether one was
   * claimed.
   */
  export const claimPendingEcho = async (
    db: DbClient,
    input: { storeId: string; conversationId: string; body: string; providerMessageId: string }
  ) => {
    const {
      records: [pending]
    } = await db.messages.findMany({
      select: { id: true },
      where: {
        conversation_id: input.conversationId,
        body: input.body,
        provider_message_id: { startsWith: PENDING_PREFIX }
      },
      order: { created_at: Order.Asc },
      take: 1
    });

    if (!pending) {
      return false;
    }

    await db.messages.updateOne({
      data: { provider_message_id: input.providerMessageId },
      where: { id: pending.id }
    });

    return true;
  };

  const PANEL_CONVERSATION_LIMIT = 50;

  const PANEL_MESSAGE_LIMIT = 100;

  const PANEL_PREVIEW_LENGTH = 120;

  /**
   * Every conversation a person is handling or must approve (never paged out), then the newest ones with the bot, each
   * with the start of its last message.
   */
  export const listForPanel = async (db: DbClient, storeId: string) => {
    const select = {
      id: true,
      customer_id: true,
      mode: true,
      handoff_reason: true,
      approval_reason: true,
      last_message_at: true
    } as const;

    const [{ records: human }, { records: bot }] = await Promise.all([
      db.conversations.findMany({
        select,
        where: { store_id: storeId, OR: [{ mode: ConversationMode.Human }, { approval_reason: { isNull: false } }] },
        order: { last_message_at: Order.Desc }
      }),
      db.conversations.findMany({
        select,
        where: { store_id: storeId, mode: ConversationMode.Bot, approval_reason: null },
        order: { last_message_at: Order.Desc },
        take: PANEL_CONVERSATION_LIMIT
      })
    ]);

    const conversations = [...human, ...bot];

    if (!conversations.length) {
      return [];
    }

    const [{ records: customers }, lastMessages] = await Promise.all([
      db.customers.findMany({
        select: { id: true, name: true, phone: true },
        where: { id: { isIn: conversations.map(({ customer_id }) => customer_id) } }
      }),
      Promise.all(
        conversations.map(async ({ id }) => {
          const { records } = await db.messages.findMany({
            select: { author: true, body: true },
            where: { conversation_id: id },
            order: { created_at: Order.Desc },
            take: 1
          });

          return records[0] && { author: records[0].author, body: records[0].body.slice(0, PANEL_PREVIEW_LENGTH) };
        })
      )
    ]);

    return conversations.map((conversation, index) => {
      const customer = customers.find(({ id }) => id === conversation.customer_id);

      return {
        ...conversation,
        customer: { name: customer?.name ?? null, phone: customer?.phone ?? '' },
        last_message: lastMessages[index] ?? null
      };
    });
  };

  export const findForStore = async (db: DbClient, storeId: string, conversationId: string) => {
    const conversation = await db.conversations.findOne({
      select: {
        id: true,
        store_id: true,
        customer_id: true,
        mode: true,
        handoff_reason: true,
        approval_reason: true,
        last_message_at: true
      },
      where: { id: conversationId }
    });

    if (!conversation || conversation.store_id !== storeId) {
      return undefined;
    }

    const customer = await db.customers.findOne({
      select: { name: true, phone: true, whatsapp_jid: true },
      where: { id: conversation.customer_id }
    });

    return {
      ...conversation,
      handoff_reason: conversation.handoff_reason ?? null,
      approval_reason: conversation.approval_reason ?? null,
      customer: {
        name: customer?.name ?? null,
        phone: customer?.phone ?? '',
        jid: customer?.whatsapp_jid ?? ''
      }
    };
  };

  /**
   * Whole thread as the store sees it (the order-memory window only cuts the model context).
   */
  export const messagesForPanel = async (db: DbClient, conversationId: string) => {
    const { records } = await db.messages.findMany({
      select: { id: true, author: true, body: true, created_at: true, reaction: true, audio_key: true },
      where: { conversation_id: conversationId },
      order: { created_at: Order.Desc },
      take: PANEL_MESSAGE_LIMIT
    });

    return records.reverse();
  };

  /**
   * Back to the bot clears the handoff reason.
   */
  export const setMode = async (
    db: DbClient,
    input: { conversationId: string; mode: ConversationMode; reason?: string }
  ) => {
    await db.conversations.updateOne({
      data: {
        mode: input.mode,
        handoff_reason: input.mode === ConversationMode.Human ? (input.reason ?? null) : null,
        approval_reason: null
      },
      where: { id: input.conversationId }
    });

    if (input.mode === ConversationMode.Human) {
      await BillingRepository.recordHandoff(db, {
        conversationId: input.conversationId,
        reason: input.reason ?? null,
        botServed: await botServed(db, input.conversationId)
      });
    }
  };

  /**
   * The bot hit a limit the store may lift: it waits (no reply, messages stay pending) until the store approves or
   * takes over. Nothing is billed here; taking over bills as a handoff.
   */
  export const requestApproval = async (db: DbClient, input: { conversationId: string; reason: string }) => {
    await db.conversations.updateOne({
      data: { approval_reason: input.reason },
      where: { id: input.conversationId }
    });
  };

  /**
   * The store allowed what the bot asked: the next turn knows it (`approved_reason`) and answers the pending messages.
   */
  export const approve = async (db: DbClient, input: { conversationId: string; reason: string }) => {
    await db.conversations.updateOne({
      data: { approval_reason: null, approved_reason: input.reason },
      where: { id: input.conversationId }
    });
  };

  /**
   * Customer messages nobody answered (after the last bot or staff message) become pending again. Returns the newest
   * one, which the caller queues so the bot answers them all.
   */
  export const reopenUnanswered = async (db: DbClient, conversationId: string) => {
    const { records: outbound } = await db.messages.findMany({
      select: { created_at: true },
      where: { conversation_id: conversationId, direction: MessageDirection.Out },
      order: { created_at: Order.Desc },
      take: 1
    });

    const since = outbound[0]?.created_at;

    const { records: unanswered } = await db.messages.findMany({
      select: { id: true },
      where: {
        conversation_id: conversationId,
        direction: MessageDirection.In,
        ...(since && { created_at: { gt: since } })
      },
      order: { created_at: Order.Asc }
    });

    if (!unanswered.length) {
      return undefined;
    }

    await db.messages.updateMany({
      data: { processed_at: null },
      where: { id: { isIn: unanswered.map(({ id }) => id) } }
    });

    return unanswered[unanswered.length - 1]!.id;
  };
}
