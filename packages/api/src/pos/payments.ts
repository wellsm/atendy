import type { PosPayment, PosPaymentInput } from './types';
import type { PaymentBrands } from '../stores/types';

import { randomUUID } from 'node:crypto';

import { PosError, PosErrorCode } from './errors';
import { acceptedBrands, acceptedMethods, isBrandMethod } from '../stores/payment';
import { PaymentMethod } from '../stores/types';

const isCents = (value: number, min: number) => Number.isInteger(value) && value >= min;

/**
 * Payments must cover the total exactly, in the store's accepted methods (legacy ones expanded); card and voucher
 * payments carry one of the store's accepted brands. Cash may carry what was handed over (≥ its amount); the change
 * is the rest. A total of 0 needs no payment.
 */
export const validatePayments = (
  totalCents: number,
  store: { payment_methods: PaymentMethod[]; payment_brands?: PaymentBrands | null },
  payments: PosPaymentInput[]
): PosPayment[] => {
  const accepted = acceptedMethods(store.payment_methods);
  const brands = acceptedBrands(store.payment_methods, store.payment_brands);

  if (!payments.length && totalCents === 0) {
    return [];
  }

  if (!payments.length) {
    throw new PosError(PosErrorCode.Payments, 'At least one payment is required');
  }

  const result = payments.map(({ method, brand, amountCents, receivedCents }) => {
    if (!accepted.includes(method)) {
      throw new PosError(PosErrorCode.Method, `The store does not accept ${method}`);
    }

    if (isBrandMethod(method) && (!brand || !brands[method]?.includes(brand))) {
      throw new PosError(PosErrorCode.Brand, `The store does not accept this ${method} brand`);
    }

    if (!isCents(amountCents, 1)) {
      throw new PosError(PosErrorCode.Payments, 'Invalid payment amount');
    }

    const received = receivedCents ?? null;

    if (received !== null && (method !== PaymentMethod.Cash || !isCents(received, amountCents))) {
      throw new PosError(PosErrorCode.Payments, 'Received cash must cover its amount');
    }

    return {
      id: randomUUID(),
      method,
      brand: isBrandMethod(method) ? brand! : null,
      amountCents,
      receivedCents: received,
      changeCents: received === null ? null : received - amountCents
    };
  });

  if (result.reduce((total, { amountCents }) => total + amountCents, 0) !== totalCents) {
    throw new PosError(PosErrorCode.Payments, 'Payments must add up to the total');
  }

  return result;
};
