import type { PaymentBrands } from './types';

import { PaymentMethod } from './types';

/**
 * What a store can accept today, in display order.
 */
export const OFFERED_METHODS = [
  PaymentMethod.Pix,
  PaymentMethod.Cash,
  PaymentMethod.Credit,
  PaymentMethod.Debit,
  PaymentMethod.MealVoucher,
  PaymentMethod.FoodVoucher
] as const;

export type BrandMethod =
  PaymentMethod.Credit | PaymentMethod.Debit | PaymentMethod.MealVoucher | PaymentMethod.FoodVoucher;

/**
 * Brands per method; the web keeps the same list (`lib/payment.ts`).
 */
export const PAYMENT_BRANDS: Record<BrandMethod, readonly string[]> = {
  [PaymentMethod.Credit]: ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Diners'],
  [PaymentMethod.Debit]: ['Visa', 'Mastercard', 'Elo', 'Maestro'],
  [PaymentMethod.MealVoucher]: [
    'Alelo',
    'Ticket',
    'VR',
    'Pluxee (Sodexo)',
    'Ben',
    'Caju',
    'Flash',
    'Swile',
    'iFood Benefícios'
  ],
  [PaymentMethod.FoodVoucher]: ['Alelo', 'Ticket', 'VR', 'Pluxee (Sodexo)', 'Ben', 'Caju', 'Flash']
};

export const isBrandMethod = (method: PaymentMethod): method is BrandMethod => method in PAYMENT_BRANDS;

const LEGACY: Partial<Record<PaymentMethod, PaymentMethod[]>> = {
  [PaymentMethod.Card]: [PaymentMethod.Credit, PaymentMethod.Debit],
  [PaymentMethod.Voucher]: [PaymentMethod.MealVoucher, PaymentMethod.FoodVoucher]
};

/**
 * A store's accepted methods with legacy values expanded (`card` → credit + debit, `voucher` → VR + VA), in
 * `OFFERED_METHODS` order.
 */
export const acceptedMethods = (stored: PaymentMethod[] | null | undefined): PaymentMethod[] => {
  const expanded = new Set((stored ?? []).flatMap((method) => LEGACY[method] ?? [method]));

  return OFFERED_METHODS.filter((method) => expanded.has(method));
};

/**
 * Accepted brands of every accepted brand method (missing = the whole catalog).
 */
export const acceptedBrands = (
  methods: PaymentMethod[] | null | undefined,
  brands: PaymentBrands | null | undefined
): Partial<Record<BrandMethod, string[]>> =>
  Object.fromEntries(
    acceptedMethods(methods)
      .filter(isBrandMethod)
      .map((method) => [method, brands?.[method] ?? [...PAYMENT_BRANDS[method]]])
  );
