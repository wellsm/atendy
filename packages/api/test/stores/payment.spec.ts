import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { acceptedBrands, acceptedMethods, PAYMENT_BRANDS } from '../../src/stores/payment';
import { PaymentMethod } from '../../src/stores/types';

describe('accepted payment methods and brands', () => {
  it('expands legacy card and voucher, in display order, without duplicates', () => {
    deepEqual(acceptedMethods([PaymentMethod.Voucher, PaymentMethod.Card, PaymentMethod.Pix, PaymentMethod.Credit]), [
      PaymentMethod.Pix,
      PaymentMethod.Credit,
      PaymentMethod.Debit,
      PaymentMethod.MealVoucher,
      PaymentMethod.FoodVoucher
    ]);
    deepEqual(acceptedMethods(null), []);
  });

  it('gives every brand of a method without a list, and nothing for methods not accepted', () => {
    deepEqual(
      acceptedBrands([PaymentMethod.Pix, PaymentMethod.Credit, PaymentMethod.Debit], {
        debit: ['Elo'],
        food_voucher: ['Ben']
      }),
      {
        credit: [...PAYMENT_BRANDS[PaymentMethod.Credit]],
        debit: ['Elo']
      }
    );
  });
});
