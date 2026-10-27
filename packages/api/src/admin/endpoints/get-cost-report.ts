import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminProvider } from '../provider';
import type { AiCost } from '../reports/cost';
import type { AdminIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { requireAdminStore } from '../detail';
import { aggregateCost, parsePeriod, ReportPeriodError } from '../reports/cost';
import { CostReportRepository } from '../reports/repository';

export declare class GetCostReportRequest implements Http.Request {
  identity: AdminIdentity;
  query: {
    /**
     * Absent = every store.
     */
    storeId?: String.UUID;
    /**
     * `YYYY-MM-DD`, Sao Paulo day, inclusive.
     */
    from: string;
    to: string;
  };
}

export declare class GetCostReportResponse implements Http.Response {
  status: 200;
  body: {
    period: {
      from: string;
      to: string;
      days: number;
    };
    /**
     * Conversations with at least one AI call in the period.
     */
    conversations: number;
    orders: {
      placed: number;
      canceled: number;
    };
    /**
     * Current handoff reason of the served conversations (only the last reason is stored).
     */
    handoffs: {
      reason: string;
      count: number;
    }[];
    ai: AiCost;
    /**
     * Turns that tried Jev and how many Jev decided alone; null without Jev calls.
     */
    jev: {
      turns: number;
      direct: number;
    } | null;
    /**
     * Billed order cycles in the period: placed by the bot (100 %) or handed to a person (by AI progress).
     */
    billing: {
      orders: number;
      placed: number;
      amountCents: number;
      averagePercent: number | null;
    };
    /**
     * Public menu orders: WhatsApp codes sent (each one is a Meta charge), verified, used by an order; web orders
     * billed and their amount. The code price is typed in the browser.
     */
    webOrders: {
      codesSent: number;
      /**
       * WhatsApp delivery from Meta's webhook; codes without a status yet count in neither.
       */
      codesDelivered: number;
      codesFailed: number;
      failures: { reason: string; count: number }[];
      codesVerified: number;
      codesWithOrder: number;
      orders: number;
      amountCents: number;
    };
  };
}

/**
 * Facts only (counts and USD). Salary, exchange rate and infra are assumptions the admin types in the browser.
 */
export async function getCostReportHandler(
  request: Http.Incoming<GetCostReportRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<GetCostReportResponse> {
  const { storeId, from, to } = request.query;

  const period = (() => {
    try {
      return parsePeriod(from, to);
    } catch (error) {
      if (error instanceof ReportPeriodError) {
        throw new HttpBadRequestError(error.message, { field: 'period' });
      }

      throw error;
    }
  })();

  if (storeId) {
    await requireAdminStore(db, storeId);
  }

  const scope = { storeId, startIso: period.startIso, endIso: period.endIso };

  const [rows, orders, billing, webOrders] = await Promise.all([
    CostReportRepository.loadAiCalls(db, scope),
    CostReportRepository.countOrders(db, scope),
    CostReportRepository.summarizeBilling(db, scope),
    CostReportRepository.summarizeWebOrders(db, scope)
  ]);

  const { conversations, ai, jev } = aggregateCost(rows);
  const served = [...new Set(rows.map(({ conversation_id }) => conversation_id))];

  return {
    status: 200,
    body: {
      period: { from: period.from, to: period.to, days: period.days },
      conversations,
      orders,
      handoffs: await CostReportRepository.countHandoffs(db, served),
      ai,
      jev,
      billing,
      webOrders
    }
  };
}
