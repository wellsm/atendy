import type { DbClient } from '../../db';

import { Order } from '@ez4/database';

import { ConversationMode, MessageDirection } from '../../conversations/types';

export const PAGE_SIZE = 50;

const PREVIEW_LENGTH = 80;

const ERROR_REASONS = ['send_failed', 'technical_error'];

export const enum ConversationFilter {
  All = 'all',
  NeedsHuman = 'needs_human',
  Errors = 'errors'
}

const CONVERSATION_FIELDS = {
  id: true,
  store_id: true,
  customer_id: true,
  mode: true,
  handoff_reason: true,
  last_message_at: true
} as const;

type ConversationRow = {
  id: string;
  store_id: string;
  customer_id: string;
  mode: ConversationMode;
  handoff_reason?: string | null;
  last_message_at: string;
};

/**
 * Store names and customer phones of the given conversations.
 */
const labels = async (db: DbClient, conversations: ConversationRow[]) => {
  if (!conversations.length) {
    return { stores: new Map<string, string>(), phones: new Map<string, string>() };
  }

  const [{ records: stores }, { records: customers }] = await Promise.all([
    db.stores.findMany({
      select: { id: true, name: true },
      where: { id: { isIn: [...new Set(conversations.map(({ store_id }) => store_id))] } }
    }),
    db.customers.findMany({
      select: { id: true, phone: true },
      where: { id: { isIn: [...new Set(conversations.map(({ customer_id }) => customer_id))] } }
    })
  ]);

  return {
    stores: new Map(stores.map(({ id, name }) => [id, name])),
    phones: new Map(customers.map(({ id, phone }) => [id, phone]))
  };
};

export namespace InspectorRepository {
  /**
   * Conversations of every store (or one), newest first, one page before `before`.
   */
  export const list = async (
    db: DbClient,
    input: { storeId?: string; filter: ConversationFilter; before?: string }
  ) => {
    const { records } = await db.conversations.findMany({
      select: CONVERSATION_FIELDS,
      where: {
        ...(input.storeId && { store_id: input.storeId }),
        ...(input.filter === ConversationFilter.NeedsHuman && { mode: ConversationMode.Human }),
        ...(input.filter === ConversationFilter.Errors && { handoff_reason: { isIn: ERROR_REASONS } }),
        ...(input.before && { last_message_at: { lt: input.before } })
      },
      order: { last_message_at: Order.Desc },
      take: PAGE_SIZE
    });

    const [{ stores, phones }, previews] = await Promise.all([
      labels(db, records),
      Promise.all(
        records.map(async ({ id }) => {
          const { records: last } = await db.messages.findMany({
            select: { body: true },
            where: { conversation_id: id },
            order: { created_at: Order.Desc },
            take: 1
          });

          return (last[0]?.body ?? '').slice(0, PREVIEW_LENGTH);
        })
      )
    ]);

    return records.map((conversation, index) => ({
      id: conversation.id,
      storeId: conversation.store_id,
      storeName: stores.get(conversation.store_id) ?? '',
      customerPhone: phones.get(conversation.customer_id) ?? '',
      mode: conversation.mode,
      handoffReason: conversation.handoff_reason ?? null,
      lastMessageAt: conversation.last_message_at,
      preview: previews[index] ?? ''
    }));
  };

  /**
   * One conversation with all its messages and AI calls, oldest first; undefined when unknown.
   */
  export const get = async (db: DbClient, conversationId: string) => {
    const conversation = await db.conversations.findOne({ select: CONVERSATION_FIELDS, where: { id: conversationId } });

    if (!conversation) {
      return undefined;
    }

    const [{ stores, phones }, { records: messages }, { records: calls }] = await Promise.all([
      labels(db, [conversation]),
      db.messages.findMany({
        select: { id: true, direction: true, author: true, body: true, created_at: true },
        where: { conversation_id: conversationId },
        order: { created_at: Order.Asc }
      }),
      db.ai_calls.findMany({
        select: {
          id: true,
          provider: true,
          model: true,
          path: true,
          intent: true,
          confidence: true,
          input_tokens: true,
          output_tokens: true,
          cost_usd: true,
          latency_ms: true,
          prompt_version: true,
          tools: true,
          created_at: true
        },
        where: { conversation_id: conversationId },
        order: { created_at: Order.Asc }
      })
    ]);

    return {
      conversation: {
        id: conversation.id,
        storeId: conversation.store_id,
        storeName: stores.get(conversation.store_id) ?? '',
        customerPhone: phones.get(conversation.customer_id) ?? '',
        mode: conversation.mode,
        handoffReason: conversation.handoff_reason ?? null,
        lastMessageAt: conversation.last_message_at
      },
      messages: messages.map((message) => ({
        id: message.id,
        incoming: message.direction === MessageDirection.In,
        author: message.author,
        body: message.body,
        at: message.created_at
      })),
      aiCalls: calls.map((call) => ({
        id: call.id,
        provider: call.provider,
        model: call.model,
        path: call.path,
        intent: call.intent ?? null,
        confidence: call.confidence === null || call.confidence === undefined ? null : Number(call.confidence),
        inputTokens: call.input_tokens,
        outputTokens: call.output_tokens,
        costUsd: Number(call.cost_usd),
        latencyMs: call.latency_ms,
        promptVersion: call.prompt_version ?? null,
        tools:
          call.tools?.map((tool) => ({
            name: tool.name,
            args: tool.args === null ? null : JSON.stringify(tool.args),
            ok: tool.ok,
            ...(tool.error !== undefined && { error: tool.error })
          })) ?? null,
        at: call.created_at
      }))
    };
  };
}
