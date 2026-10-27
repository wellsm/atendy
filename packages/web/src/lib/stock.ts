export type StockUnit = 'un' | 'g' | 'ml';

export type StockFilter = 'all' | 'low' | 'sold_out' | 'archived';

export type LossReason = 'breakage' | 'expired' | 'internal_use' | 'other';

export const STOCK_FILTERS: [StockFilter, string][] = [
  ['all', 'Todos'],
  ['low', 'Baixo'],
  ['sold_out', 'Esgotado'],
  ['archived', 'Arquivados']
];

export const LOSS_REASONS: [LossReason, string][] = [
  ['breakage', 'Quebra'],
  ['expired', 'Vencido'],
  ['internal_use', 'Consumo interno'],
  ['other', 'Outro']
];

export const MOVEMENT_LABELS: Record<string, string> = {
  sale: 'Venda',
  sale_return: 'Devolução de venda',
  purchase: 'Entrada',
  loss: 'Perda',
  count: 'Contagem'
};

/**
 * The bigger unit a base unit is shown in from 1000 on (g → kg, ml → L); `un` has none.
 */
export const BIG_UNIT: Record<StockUnit, string | undefined> = { un: undefined, g: 'kg', ml: 'L' };

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * A quantity in the base unit for people: `1500, 'g'` → `1,5 kg`, `300, 'ml'` → `300 ml`, `4, 'un'` → `4 un`.
 */
export const formatQty = (qty: number, unit: StockUnit) => {
  const big = BIG_UNIT[unit];

  if (big && Math.abs(qty) >= 1000) {
    return `${decimal.format(qty / 1000)} ${big}`;
  }

  return `${decimal.format(qty)} ${unit}`;
};

/**
 * A quantity typed by the store (`12`, or `1,5` in kg / L) in the base unit; `undefined` when not a value.
 */
export const parseQty = (text: string, unit: StockUnit, inBig: boolean) => {
  const value = text.trim();
  const pattern = inBig ? /^\d+(?:[.,]\d{1,3})?$/ : /^\d+$/;

  if (!pattern.test(value)) {
    return undefined;
  }

  const number = Number(value.replace(',', '.'));

  return Math.round(inBig && BIG_UNIT[unit] ? number * 1000 : number);
};

/**
 * A base quantity as typed text, in the bigger unit when it divides evenly: `1500, 'g'` → `{ text: '1,5', inBig: true }`.
 */
export const qtyToInput = (qty: number, unit: StockUnit) =>
  BIG_UNIT[unit] && qty >= 1000 && qty % 100 === 0
    ? { text: String(qty / 1000).replace('.', ','), inBig: true }
    : { text: String(qty), inBig: false };

/**
 * Average cost (millicents per base unit) as a price per kg / L / un, in cents.
 */
export const costPerBigUnitCents = (millicentsPerUnit: number, unit: StockUnit) =>
  Math.round(unit === 'un' ? millicentsPerUnit / 1000 : millicentsPerUnit);

export const costUnitLabel = (unit: StockUnit) => BIG_UNIT[unit] ?? 'un';
