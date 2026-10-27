import type { DbClient } from '../db';
import type { BillingStep } from './progress';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import {
  billingAmountCents,
  billingPercent,
  BillingStep as Step,
  DEFAULT_ORDER_PRICE_CENTS,
  DEFAULT_WEB_ORDER_PERCENT,
  stepsFromCart
} from './progress';
import { BillingOutcome } from './types';
import { OrderRepository } from '../orders/repository';
import { orderMemorySince } from '../stores/policy';

type Billing = {
  storeId: string;
  conversationId: string;
  orderId: string | null;
  outcome: BillingOutcome;
  handoffReason: string | null;
  steps: BillingStep[];
  /**
   * Fixed percent instead of the one computed from `steps` (web orders).
   */
  percent?: number;
};

const RECORD_FIELDS = { id: true, percent: true, price_cents: true } as const;

/**
 * Start of the conversation's current order cycle: when its previous order was placed (none = since ever).
 */
const cycleStart = async (db: DbClient, conversationId: string, excludeOrderId?: string) => {
  const { records } = await db.orders.findMany({
    select: { id: true, placed_at: true },
    where: { conversation_id: conversationId, placed_at: { isNull: false } },
    order: { placed_at: Order.Desc },
    take: 2
  });

  return records.find(({ id }) => id !== excludeOrderId)?.placed_at ?? undefined;
};

/**
 * The row this billing updates: the order's own, else the no-order row of the same cycle (a handoff before any draft
 * that later became this order).
 */
const findCurrent = async (db: DbClient, conversationId: string, orderId: string | null) => {
  if (orderId) {
    const {
      records: [own]
    } = await db.billing_records.findMany({ select: RECORD_FIELDS, where: { order_id: orderId }, take: 1 });

    if (own) {
      return own;
    }
  }

  const since = await cycleStart(db, conversationId, orderId ?? undefined);

  const {
    records: [open]
  } = await db.billing_records.findMany({
    select: RECORD_FIELDS,
    where: {
      conversation_id: conversationId,
      order_id: { isNull: true },
      ...(since && { created_at: { gte: since } })
    },
    take: 1
  });

  return open;
};

/**
 * One row per order cycle; a later billing only raises it (the AI never "un-does" a step it reached).
 */
const save = async (db: DbClient, billing: Billing) => {
  const percent = billing.percent ?? billingPercent(billing.steps, billing.handoffReason);
  const current = await findCurrent(db, billing.conversationId, billing.orderId);
  const now = new Date().toISOString();

  if (current && current.percent >= percent) {
    return;
  }

  const data = {
    order_id: billing.orderId,
    outcome: billing.outcome,
    handoff_reason: billing.handoffReason,
    steps: billing.steps,
    percent,
    updated_at: now
  };

  if (current) {
    await db.billing_records.updateOne({
      data: { ...data, amount_cents: billingAmountCents(current.price_cents, percent) },
      where: { id: current.id }
    });

    return;
  }

  const store = await db.stores.findOne({ select: { order_price_cents: true }, where: { id: billing.storeId } });
  const price = store?.order_price_cents ?? DEFAULT_ORDER_PRICE_CENTS;

  await db.billing_records.insertOne({
    data: {
      id: randomUUID(),
      store_id: billing.storeId,
      conversation_id: billing.conversationId,
      ...data,
      price_cents: price,
      amount_cents: billingAmountCents(price, percent),
      created_at: now
    }
  });
};

export namespace BillingRepository {
  /**
   * The customer placed the order on the public menu: the store's web percent of its price.
   */
  export const recordWebOrder = async (
    db: DbClient,
    input: { storeId: string; conversationId: string; orderId: string }
  ) => {
    const store = await db.stores.findOne({ select: { web_order_percent: true }, where: { id: input.storeId } });

    await save(db, {
      ...input,
      outcome: BillingOutcome.Web,
      handoffReason: null,
      steps: [Step.Items, Step.Fulfillment, Step.Address, Step.Payment, Step.Placed],
      percent: store?.web_order_percent ?? DEFAULT_WEB_ORDER_PERCENT
    });
  };

  /**
   * The bot placed the order: 100 % (amending it later never bills again).
   */
  export const recordPlaced = async (
    db: DbClient,
    input: { storeId: string; conversationId: string; orderId: string }
  ) => {
    await save(db, {
      ...input,
      outcome: BillingOutcome.Placed,
      handoffReason: null,
      steps: [Step.Items, Step.Fulfillment, Step.Address, Step.Payment, Step.Placed]
    });
  };

  /**
   * A person takes over: bills what the AI finished in the draft so far. Without a draft, nothing when the last placed
   * order is still the current one (already billed) or the bot never answered in this cycle (`botServed`: the store
   * served alone), else a no-order row.
   */
  export const recordHandoff = async (
    db: DbClient,
    input: { conversationId: string; reason: string | null; botServed: boolean }
  ) => {
    const conversation = await db.conversations.findOne({
      select: { store_id: true, draft_order_id: true },
      where: { id: input.conversationId }
    });

    if (!conversation) {
      return;
    }

    const base = {
      storeId: conversation.store_id,
      conversationId: input.conversationId,
      outcome: BillingOutcome.Handoff,
      handoffReason: input.reason
    };

    if (conversation.draft_order_id) {
      const cart = await OrderRepository.getCart(db, conversation.draft_order_id);

      await save(db, { ...base, orderId: conversation.draft_order_id, steps: stepsFromCart(cart) });

      return;
    }

    if (!input.botServed) {
      return;
    }

    const [lastPlaced, store] = await Promise.all([
      OrderRepository.findLastPlaced(db, input.conversationId),
      db.stores.findOne({ select: { policy: true }, where: { id: conversation.store_id } })
    ]);

    if (lastPlaced && Date.parse(lastPlaced.placedAt) >= Date.parse(orderMemorySince(store?.policy, new Date()))) {
      return;
    }

    await save(db, { ...base, orderId: null, steps: [] });
  };
}
