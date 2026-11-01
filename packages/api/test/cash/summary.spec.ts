import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cashSummary } from '../../src/cash/summary';
import { CashMovementKind } from '../../src/cash/types';
import { PaymentMethod } from '../../src/stores/types';

describe('cashSummary', () => {
  it('adds float, cash sales, order cash and suprimentos, minus sangrias and cash refunds', () => {
    const report = cashSummary({
      floatCents: 10000,
      payments: [
        { method: PaymentMethod.Cash, amountCents: 3000, canceled: false },
        { method: PaymentMethod.Pix, amountCents: 2000, canceled: false }
      ],
      movements: [
        { kind: CashMovementKind.Sangria, method: PaymentMethod.Cash, amountCents: 1000 },
        { kind: CashMovementKind.Suprimento, method: PaymentMethod.Cash, amountCents: 500 },
        { kind: CashMovementKind.OrderCash, method: PaymentMethod.Cash, amountCents: 4000 },
        { kind: CashMovementKind.Refund, method: PaymentMethod.Cash, amountCents: 500 }
      ],
      discountsCents: 0,
      surchargesCents: 0,
      salesCount: 2,
      canceledCount: 0
    });

    equal(report.expectedCashCents, 16000);
    equal(report.byMethod.pix, 2000);
    equal(report.refundsByMethod.cash, 500);
    equal(report.salesCents, 5000);
    equal(report.differenceCents, null);
  });

  it('subtracts courier payouts from the expected cash', () => {
    const report = cashSummary({
      floatCents: 10000,
      payments: [],
      movements: [{ kind: CashMovementKind.CourierPayout, method: PaymentMethod.Cash, amountCents: 1500 }],
      discountsCents: 0,
      surchargesCents: 0,
      salesCount: 0,
      canceledCount: 0
    });

    equal(report.courierPayoutCents, 1500);
    equal(report.expectedCashCents, 8500);
  });

  it('keeps canceled sales by method but out of the sales total, and counts the difference', () => {
    const report = cashSummary({
      floatCents: 0,
      payments: [
        { method: PaymentMethod.Card, amountCents: 1500, canceled: true },
        { method: PaymentMethod.Cash, amountCents: 1000, canceled: false }
      ],
      movements: [{ kind: CashMovementKind.Refund, method: PaymentMethod.Card, amountCents: 1500 }],
      discountsCents: 0,
      surchargesCents: 0,
      salesCount: 1,
      canceledCount: 1,
      countedCents: 900
    });

    equal(report.byMethod.card, 1500);
    equal(report.refundsByMethod.card, 1500);
    equal(report.salesCents, 1000);
    equal(report.expectedCashCents, 1000);
    equal(report.differenceCents, -100);
  });
});
