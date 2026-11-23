import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PosError, PosErrorCode } from '../../src/pos/errors';
import { validatePayments } from '../../src/pos/payments';
import { PaymentMethod } from '../../src/stores/types';

describe('validatePayments', () => {
  const accepted = { payment_methods: [PaymentMethod.Cash, PaymentMethod.Pix] };

  const isPosError = (code: PosErrorCode) => (error: unknown) => error instanceof PosError && error.code === code;

  it('splits the total and gives cash change', () => {
    const payments = validatePayments(8200, accepted, [
      { method: PaymentMethod.Pix, amountCents: 5000 },
      { method: PaymentMethod.Cash, amountCents: 3200, receivedCents: 5000 }
    ]);

    deepEqual(
      payments.map(({ method, receivedCents, changeCents }) => ({ method, receivedCents, changeCents })),
      [
        { method: PaymentMethod.Pix, receivedCents: null, changeCents: null },
        { method: PaymentMethod.Cash, receivedCents: 5000, changeCents: 1800 }
      ]
    );
  });

  it('refuses payments that miss the total, other methods and short cash', () => {
    throws(
      () =>
        validatePayments(8200, accepted, [
          { method: PaymentMethod.Pix, amountCents: 5000 },
          { method: PaymentMethod.Cash, amountCents: 3100 }
        ]),
      isPosError(PosErrorCode.Payments)
    );

    throws(
      () => validatePayments(8200, accepted, [{ method: PaymentMethod.Card, amountCents: 8200 }]),
      isPosError(PosErrorCode.Method)
    );

    throws(
      () =>
        validatePayments(8200, accepted, [
          { method: PaymentMethod.Pix, amountCents: 5000 },
          { method: PaymentMethod.Cash, amountCents: 3200, receivedCents: 3000 }
        ]),
      isPosError(PosErrorCode.Payments)
    );

    throws(
      () => validatePayments(1000, accepted, [{ method: PaymentMethod.Pix, amountCents: 1000, receivedCents: 1000 }]),
      isPosError(PosErrorCode.Payments)
    );

    throws(() => validatePayments(1000, accepted, []), isPosError(PosErrorCode.Payments));
  });

  it('needs an accepted brand on card and voucher payments, none on pix', () => {
    const store = {
      payment_methods: [PaymentMethod.Pix, PaymentMethod.Credit, PaymentMethod.MealVoucher],
      payment_brands: { credit: ['Visa'] }
    };

    throws(
      () => validatePayments(1000, store, [{ method: PaymentMethod.Credit, amountCents: 1000 }]),
      isPosError(PosErrorCode.Brand)
    );
    throws(
      () => validatePayments(1000, store, [{ method: PaymentMethod.Credit, brand: 'Elo', amountCents: 1000 }]),
      isPosError(PosErrorCode.Brand)
    );
    throws(
      () => validatePayments(1000, store, [{ method: PaymentMethod.Debit, brand: 'Visa', amountCents: 1000 }]),
      isPosError(PosErrorCode.Method)
    );

    deepEqual(
      validatePayments(3000, store, [
        { method: PaymentMethod.Credit, brand: 'Visa', amountCents: 1000 },
        { method: PaymentMethod.MealVoucher, brand: 'Caju', amountCents: 1000 },
        { method: PaymentMethod.Pix, brand: 'Visa', amountCents: 1000 }
      ]).map(({ method, brand }) => [method, brand]),
      [
        [PaymentMethod.Credit, 'Visa'],
        [PaymentMethod.MealVoucher, 'Caju'],
        [PaymentMethod.Pix, null]
      ]
    );
  });

  it('reads a legacy card list as credit and debit, never card itself', () => {
    const legacy = { payment_methods: [PaymentMethod.Card] };

    equal(
      validatePayments(1000, legacy, [{ method: PaymentMethod.Debit, brand: 'Maestro', amountCents: 1000 }])[0]?.brand,
      'Maestro'
    );
    throws(
      () => validatePayments(1000, legacy, [{ method: PaymentMethod.Card, amountCents: 1000 }]),
      isPosError(PosErrorCode.Method)
    );
  });

  it('needs no payment for a total of 0', () => {
    equal(validatePayments(0, accepted, []).length, 0);
  });
});
