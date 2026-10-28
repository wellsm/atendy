import { CashMovementKind } from './types';
import { PaymentMethod } from '../stores/types';

/**
 * Cents per payment method. Spelled out instead of `Record<PaymentMethod, number>` so Ez4 can read it in response
 * bodies; `emptyTotals` keeps it in step with `PaymentMethod`.
 */
export type MethodTotals = { pix: number; card: number; cash: number; voucher: number };

export type CashReport = {
  floatCents: number;
  /**
   * POS payments by method; canceled sales stay here (their refunds subtract).
   */
  byMethod: MethodTotals;
  refundsByMethod: MethodTotals;
  orderCashCents: number;
  sangriaCents: number;
  suprimentoCents: number;
  expectedCashCents: number;
  salesCount: number;
  /**
   * Payments of the sales that were not canceled.
   */
  salesCents: number;
  canceledCount: number;
  discountsCents: number;
  surchargesCents: number;
  countedCents: number | null;
  differenceCents: number | null;
};

/**
 * `CashReport` as the panel reads it: an open session under blind close hides the expected cash and the difference.
 */
export type CashReportView = {
  floatCents: number;
  byMethod: MethodTotals;
  refundsByMethod: MethodTotals;
  orderCashCents: number;
  sangriaCents: number;
  suprimentoCents: number;
  expectedCashCents: number | null;
  salesCount: number;
  salesCents: number;
  canceledCount: number;
  discountsCents: number;
  surchargesCents: number;
  countedCents: number | null;
  differenceCents: number | null;
};

/**
 * Blind close: the panel sees the open session's report without the expected cash until the count is confirmed.
 */
export const hideExpected = (report: CashReport): CashReportView => ({
  ...report,
  expectedCashCents: null,
  differenceCents: null
});

export type CashSummaryInput = {
  floatCents: number;
  payments: { method: PaymentMethod; amountCents: number; canceled: boolean }[];
  movements: { kind: CashMovementKind; method: PaymentMethod; amountCents: number }[];
  discountsCents: number;
  surchargesCents: number;
  salesCount: number;
  canceledCount: number;
  /**
   * Set once the session is closed: the difference is counted − expected ("sobra" > 0, "falta" < 0).
   */
  countedCents?: number | null;
};

const emptyTotals = (): MethodTotals =>
  ({
    [PaymentMethod.Pix]: 0,
    [PaymentMethod.Card]: 0,
    [PaymentMethod.Cash]: 0,
    [PaymentMethod.Voucher]: 0
  }) satisfies Record<PaymentMethod, number>;

/**
 * Expected cash = float + POS cash + order cash + suprimentos − sangrias − cash refunds. Other methods are totals only.
 */
export const cashSummary = (input: CashSummaryInput): CashReport => {
  const byMethod = emptyTotals();
  const refundsByMethod = emptyTotals();

  let salesCents = 0;
  let orderCashCents = 0;
  let sangriaCents = 0;
  let suprimentoCents = 0;

  for (const payment of input.payments) {
    byMethod[payment.method] += payment.amountCents;

    if (!payment.canceled) {
      salesCents += payment.amountCents;
    }
  }

  for (const movement of input.movements) {
    switch (movement.kind) {
      case CashMovementKind.Refund:
        refundsByMethod[movement.method] += movement.amountCents;
        break;

      case CashMovementKind.OrderCash:
        orderCashCents += movement.amountCents;
        break;

      case CashMovementKind.Sangria:
        sangriaCents += movement.amountCents;
        break;

      case CashMovementKind.Suprimento:
        suprimentoCents += movement.amountCents;
        break;
    }
  }

  const expectedCashCents =
    input.floatCents + byMethod.cash + orderCashCents + suprimentoCents - sangriaCents - refundsByMethod.cash;

  const countedCents = input.countedCents ?? null;

  return {
    floatCents: input.floatCents,
    byMethod,
    refundsByMethod,
    orderCashCents,
    sangriaCents,
    suprimentoCents,
    expectedCashCents,
    salesCount: input.salesCount,
    salesCents,
    canceledCount: input.canceledCount,
    discountsCents: input.discountsCents,
    surchargesCents: input.surchargesCents,
    countedCents,
    differenceCents: countedCents === null ? null : countedCents - expectedCashCents
  };
};
