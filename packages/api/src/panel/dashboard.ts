import type { DbClient } from '../db';

import { BillingStep, DEFAULT_ORDER_PRICE_CENTS, stepsFromOrder } from '../billing/progress';
import { BillingOutcome } from '../billing/types';
import { OrderRepository } from '../orders/repository';
import { OrderSource, OrderStatus } from '../orders/types';
import { localDay, localMonth, monthCycle } from '../payments/cycle';

/**
 * Handoffs caused by us: shown apart, never billed.
 */
const FAILURE_REASONS = new Set(['technical_error', 'send_failed']);

/**
 * Funnel order: `conversation` is every cycle; the others are the billing steps.
 */
export const FUNNEL_STEPS = [
  'conversation',
  BillingStep.Items,
  BillingStep.Fulfillment,
  BillingStep.Address,
  BillingStep.Payment,
  BillingStep.Placed
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export type DashboardDay = {
  date: string;
  orders: number;
  conversations: number;
  costCents: number;
};

export type Dashboard = {
  month: string;
  current: boolean;
  priceCents: number;
  totals: {
    /**
     * Bot order cycles: billed ones (not web) plus abandoned drafts with items.
     */
    conversations: number;
    placedByBot: number;
    placedByStore: number;
    /**
     * Placed by customers on the public menu (billed at the web percent).
     */
    placedByWeb: number;
    handoffs: number;
    abandoned: number;
    failures: number;
    costCents: number;
    /**
     * Current month only: cost so far per elapsed day × days in the month.
     */
    forecastCents: number | null;
    costPerOrderCents: number | null;
  };
  days: DashboardDay[];
  funnel: { step: FunnelStep; count: number }[];
  handoffReasons: { reason: string; count: number }[];
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (month: string) => MONTH_PATTERN.test(month);

const daysOf = (month: string) => {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();

  return Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`);
};

/**
 * One billing month of a store: cycles (billed + abandoned with items), how far each got, how each ended, orders
 * and cost per day. Days follow the billing cycle (Brazil, UTC−3).
 */
export const buildDashboard = async (db: DbClient, storeId: string, month: string, now: Date): Promise<Dashboard> => {
  const { periodStart, periodEnd } = monthCycle(month);
  const period = { gte: periodStart, lt: periodEnd };

  // The month must count drafts already left even if no customer came back to mark them.
  await OrderRepository.abandonStaleDrafts(db, now, storeId);

  const [store, { records: billed }, { records: abandonedRows }, { records: placed }] = await Promise.all([
    db.stores.findOne({ select: { order_price_cents: true }, where: { id: storeId } }),
    db.billing_records.findMany({
      select: {
        order_id: true,
        outcome: true,
        handoff_reason: true,
        steps: true,
        amount_cents: true,
        created_at: true
      },
      where: { store_id: storeId, created_at: period }
    }),
    db.orders.findMany({
      select: {
        id: true,
        subtotal_cents: true,
        fulfillment: true,
        address: true,
        payment_method: true,
        abandoned_at: true
      },
      where: { store_id: storeId, status: OrderStatus.Abandoned, subtotal_cents: { gt: 0 }, abandoned_at: period }
    }),
    db.orders.findMany({
      select: { id: true, status: true, placed_at: true },
      // Counter sales are not WhatsApp orders (`not` alone drops null sources).
      where: {
        store_id: storeId,
        placed_at: period,
        OR: [{ source: { isNull: true } }, { source: { not: OrderSource.Pos } }]
      }
    })
  ]);

  const billedOrders = new Set(billed.flatMap(({ order_id }) => (order_id ? [order_id] : [])));

  // A draft handed to a person was billed then: it is that cycle, not another one.
  const abandoned = abandonedRows.filter(({ id }) => !billedOrders.has(id));

  // Web orders are billed, but no bot conversation led to them: they stay out of the funnel.
  const web = billed.filter(({ outcome }) => outcome === BillingOutcome.Web).length;

  const cycles = [
    ...billed.filter(({ outcome }) => outcome !== BillingOutcome.Web).map(({ steps }) => steps),
    ...abandoned.map((order) => stepsFromOrder({ ...order, placed_at: null }))
  ];

  const handoffs = billed.filter(({ outcome }) => outcome === BillingOutcome.Handoff);
  const failures = handoffs.filter(({ handoff_reason }) => FAILURE_REASONS.has(handoff_reason ?? ''));
  const costCents = billed.reduce((total, { amount_cents }) => total + amount_cents, 0);
  const kept = placed.filter(({ status }) => status !== OrderStatus.Canceled);
  const placedByBot = billed.filter(({ outcome }) => outcome === BillingOutcome.Placed).length;

  const reasons = new Map<string, number>();

  for (const { handoff_reason } of handoffs) {
    if (!FAILURE_REASONS.has(handoff_reason ?? '')) {
      reasons.set(handoff_reason ?? 'agent_requested', (reasons.get(handoff_reason ?? 'agent_requested') ?? 0) + 1);
    }
  }

  const current = month === localMonth(now);
  const elapsed = current ? Number(localDay(now.toISOString()).slice(8)) : 0;
  const allDays = daysOf(month);

  const days = allDays.map((date) => ({
    date,
    orders: kept.filter(({ placed_at }) => placed_at && localDay(placed_at) === date).length,
    conversations:
      billed.filter(({ created_at }) => localDay(created_at) === date).length +
      abandoned.filter(({ abandoned_at }) => abandoned_at && localDay(abandoned_at) === date).length,
    costCents: billed
      .filter(({ created_at }) => localDay(created_at) === date)
      .reduce((total, { amount_cents }) => total + amount_cents, 0)
  }));

  return {
    month,
    current,
    priceCents: store?.order_price_cents ?? DEFAULT_ORDER_PRICE_CENTS,
    totals: {
      conversations: cycles.length,
      placedByBot,
      placedByStore: placed.filter(({ id }) => !billedOrders.has(id)).length,
      placedByWeb: web,
      handoffs: handoffs.length - failures.length,
      abandoned: abandoned.length,
      failures: failures.length,
      costCents,
      forecastCents: current && elapsed ? Math.round((costCents / elapsed) * allDays.length) : null,
      costPerOrderCents: placedByBot + web ? Math.round(costCents / (placedByBot + web)) : null
    },
    days,
    funnel: FUNNEL_STEPS.map((step) => ({
      step,
      count: step === 'conversation' ? cycles.length : cycles.filter((steps) => steps.includes(step)).length
    })),
    handoffReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  };
};
