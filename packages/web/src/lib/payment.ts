/**
 * `card` and `voucher` are legacy: old orders and payments only, never offered (API `stores/payment.ts`).
 */
export type PaymentMethod = 'pix' | 'cash' | 'credit' | 'debit' | 'meal_voucher' | 'food_voucher' | 'card' | 'voucher';

export type BrandMethod = 'credit' | 'debit' | 'meal_voucher' | 'food_voucher';

export type PaymentBrands = Partial<Record<BrandMethod, string[]>>;

/**
 * What a store can accept, in display order.
 */
export const OFFERED_METHODS: PaymentMethod[] = ['pix', 'cash', 'credit', 'debit', 'meal_voucher', 'food_voucher'];

/**
 * Same catalog as the API (`PAYMENT_BRANDS`, `stores/payment.ts`): change both together.
 */
export const PAYMENT_BRANDS: Record<BrandMethod, string[]> = {
  credit: ['Visa', 'Mastercard', 'Elo', 'Hipercard', 'American Express', 'Diners'],
  debit: ['Visa', 'Mastercard', 'Elo', 'Maestro'],
  meal_voucher: ['Alelo', 'Ticket', 'VR', 'Pluxee (Sodexo)', 'Ben', 'Caju', 'Flash', 'Swile', 'iFood Benefícios'],
  food_voucher: ['Alelo', 'Ticket', 'VR', 'Pluxee (Sodexo)', 'Ben', 'Caju', 'Flash']
};

export const isBrandMethod = (method: PaymentMethod): method is BrandMethod => method in PAYMENT_BRANDS;

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  meal_voucher: 'Vale-refeição',
  food_voucher: 'Vale-alimentação',
  card: 'Cartão',
  voucher: 'Vale-refeição/alimentação'
};

/**
 * Short names for buttons (POS, attendant draft).
 */
export const PAYMENT_SHORT: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  meal_voucher: 'VR',
  food_voucher: 'VA',
  card: 'Cartão',
  voucher: 'Vale'
};
