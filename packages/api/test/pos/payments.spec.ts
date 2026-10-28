import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PosError, PosErrorCode } from '../../src/pos/errors';
import { validatePayments } from '../../src/pos/payments';
import { PaymentMethod } from '../../src/stores/types';

describe('validatePayments', () => {
  const accepted = [PaymentMethod.Cash, PaymentMethod.Pix];

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

  it('needs no payment for a total of 0', () => {
    equal(validatePayments(0, accepted, []).length, 0);
  });
});
