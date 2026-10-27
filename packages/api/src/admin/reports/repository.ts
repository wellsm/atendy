import type { CostRow } from './cost';
import type { DbClient } from '../../db';

import { BillingOutcome } from '../../billing/types';
import { OrderStatus } from '../../orders/types';

type ReportScope = {
  /**
   * Absent = every store.
   */
  storeId?: string;
  startIso: string;
  endIso: string;
};

export namespace CostReportRepository {
  export const loadAiCalls = async (db: DbClient, scope: ReportScope): Promise<CostRow[]> => {
    const { records } = await db.ai_calls.findMany({
      select: {
        provider: true,
        path: true,
        model: true,
        input_tokens: true,
        output_tokens: true,
        cost_usd: true,
        latency_ms: true,
        conversation_id: true,
        prompt_version: true
      },
      where: {
        ...(scope.storeId && { store_id: scope.storeId }),
        created_at: { gte: scope.startIso, lte: scope.endIso }
      }
    });

    return records.map((record) => ({
      ...record,
      cost_usd: Number(record.cost_usd),
      prompt_version: record.prompt_version ?? null
    }));
  };

  /**
   * What the stores pay for the period: one row per order cycle (`billing_records`), by when it was first billed.
   */
  export const summarizeBilling = async (db: DbClient, scope: ReportScope) => {
    const { records } = await db.billing_records.findMany({
      select: { outcome: true, percent: true, amount_cents: true },
      where: {
        ...(scope.storeId && { store_id: scope.storeId }),
        created_at: { gte: scope.startIso, lte: scope.endIso }
      }
    });

    const total = records.reduce((sum, { percent }) => sum + percent, 0);

    return {
      orders: records.length,
      placed: records.filter(({ outcome }) => outcome === BillingOutcome.Placed).length,
      amountCents: records.reduce((sum, { amount_cents }) => sum + amount_cents, 0),
      averagePercent: records.length ? Math.round(total / records.length) : null
    };
  };

  /**
   * Web orders and the WhatsApp codes we paid for them: every code sent costs, verified or not. Codes count by the
   * store whose menu asked for them; web billing by when it was billed.
   */
  export const summarizeWebOrders = async (db: DbClient, scope: ReportScope) => {
    const where = {
      ...(scope.storeId && { store_id: scope.storeId }),
      created_at: { gte: scope.startIso, lte: scope.endIso }
    };

    const [{ records: codes }, { records: billed }] = await Promise.all([
      db.phone_verifications.findMany({
        select: { verified_at: true, order_id: true, delivery_status: true, delivery_error: true },
        where
      }),
      db.billing_records.findMany({
        select: { amount_cents: true },
        where: { ...where, outcome: BillingOutcome.Web }
      })
    ]);

    const failures = new Map<string, number>();

    for (const { delivery_status: status, delivery_error: error } of codes) {
      if (status === 'failed') {
        failures.set(error ?? 'unknown', (failures.get(error ?? 'unknown') ?? 0) + 1);
      }
    }

    return {
      codesSent: codes.length,
      codesDelivered: codes.filter(({ delivery_status }) => ['delivered', 'read'].includes(delivery_status ?? ''))
        .length,
      codesFailed: codes.filter(({ delivery_status }) => delivery_status === 'failed').length,
      failures: [...failures.entries()].sort(([, a], [, b]) => b - a).map(([reason, count]) => ({ reason, count })),
      codesVerified: codes.filter(({ verified_at }) => verified_at).length,
      codesWithOrder: codes.filter(({ order_id }) => order_id).length,
      orders: billed.length,
      amountCents: billed.reduce((sum, { amount_cents }) => sum + amount_cents, 0)
    };
  };

  /**
   * Orders placed in the period, whatever happened to them after; canceled ones counted apart.
   */
  export const countOrders = async (db: DbClient, scope: ReportScope) => {
    const { records } = await db.orders.findMany({
      select: { status: true },
      where: {
        ...(scope.storeId && { store_id: scope.storeId }),
        placed_at: { gte: scope.startIso, lte: scope.endIso }
      }
    });

    return {
      placed: records.length,
      canceled: records.filter(({ status }) => status === OrderStatus.Canceled).length
    };
  };

  /**
   * Current handoff reason of the given conversations, counted by reason (only the last reason is stored).
   */
  export const countHandoffs = async (db: DbClient, conversationIds: string[]) => {
    if (!conversationIds.length) {
      return [];
    }

    const { records } = await db.conversations.findMany({
      select: { handoff_reason: true },
      where: { id: { isIn: conversationIds } }
    });

    const counts = new Map<string, number>();

    for (const { handoff_reason: reason } of records) {
      if (reason) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
      .map(([reason, count]) => ({ reason, count }));
  };
}
