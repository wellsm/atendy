import { parseMoney } from './format';

export type CostReport = {
  period: { from: string; to: string; days: number };
  conversations: number;
  orders: { placed: number; canceled: number };
  handoffs: { reason: string; count: number }[];
  ai: {
    total_usd: number;
    by_provider: { provider: string; calls: number; cost_usd: number }[];
    by_path: { path: string; calls: number; cost_usd: number }[];
    by_model: {
      model: string;
      provider: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      avg_latency_ms: number;
    }[];
    by_prompt_version: { version: string | null; calls: number; cost_usd: number }[];
  };
  jev: { turns: number; direct: number } | null;
  /**
   * Billed order cycles: placed by the bot (100 %) or handed to a person (by AI progress).
   */
  billing: { orders: number; placed: number; amount_cents: number; average_percent: number | null };
  web_orders: {
    codes_sent: number;
    codes_delivered: number;
    codes_failed: number;
    failures: { reason: string; count: number }[];
    codes_verified: number;
    codes_with_order: number;
    orders: number;
    amount_cents: number;
  };
};

/**
 * What the admin types: attendant salary (R$/month), charges (%), USD→BRL rate, fixed infra (R$/month) and the price
 * Meta charges per WhatsApp code (R$).
 * Never sent to the API.
 */
export type Assumptions = {
  salary: string;
  charges: string;
  rate: string;
  infra: string;
  code: string;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = { salary: '', charges: '70', rate: '', infra: '', code: '0,035' };

const STORAGE_KEY = 'atendy.cost-assumptions';

/**
 * Last typed values; storage may be blocked (private window), then the defaults.
 */
export const loadAssumptions = (): Assumptions => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Assumptions> | null;

    return { ...DEFAULT_ASSUMPTIONS, ...stored };
  } catch {
    return DEFAULT_ASSUMPTIONS;
  }
};

export const saveAssumptions = (assumptions: Assumptions) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assumptions));
  } catch {
    // Not remembered; the page keeps working.
  }
};

/**
 * `5,40` / `5.4` → 5.4; empty or invalid → undefined.
 */
export const parseDecimal = (text: string) => {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());

  return match ? Number(`${match[1]}.${match[2] ?? '0'}`) : undefined;
};

/**
 * Money as typed in Brazil: `2.500,00`, `2500,00`, `2.500`, `R$ 2500` → cents; undefined when not a value.
 */
export const parseBrl = (text: string) => {
  const clean = text.replace(/R\$/i, '').replace(/\s/g, '');
  const thousands = clean.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(clean);

  return parseMoney(thousands ? clean.replace(/\./g, '') : clean);
};

export type CostComparison =
  | { kind: 'missing' }
  | { kind: 'invalid'; field: string }
  | { kind: 'no_orders' }
  | {
      kind: 'ok';
      ordersPerMonth: number;
      aiPerOrderBrl: number;
      infraPerOrderBrl: number;
      attendantPerOrderBrl: number;
      savingsPercent: number;
    };

/**
 * AI + infra per order vs an attendant per order (docs/specs/admin-costs.md D8). A field with text that is not a
 * number is reported instead of silently counted as zero.
 */
export const costComparison = (report: CostReport, assumptions: Assumptions): CostComparison => {
  if (!assumptions.salary.trim() || !assumptions.rate.trim()) {
    return { kind: 'missing' };
  }

  const salaryCents = parseBrl(assumptions.salary);
  const rate = parseDecimal(assumptions.rate);
  const charges = assumptions.charges.trim() ? parseDecimal(assumptions.charges) : 0;
  const infraCents = assumptions.infra.trim() ? parseBrl(assumptions.infra) : 0;

  if (!salaryCents) {
    return { kind: 'invalid', field: 'Salário' };
  }

  if (!rate) {
    return { kind: 'invalid', field: 'Câmbio' };
  }

  if (charges === undefined) {
    return { kind: 'invalid', field: 'Encargos' };
  }

  if (infraCents === undefined) {
    return { kind: 'invalid', field: 'Infra fixa' };
  }

  const orders = report.orders.placed;

  if (!orders) {
    return { kind: 'no_orders' };
  }

  const ordersPerMonth = (orders / report.period.days) * 30;
  const aiPerOrderBrl = (report.ai.total_usd * rate) / orders;
  const infraPerOrderBrl = infraCents / 100 / ordersPerMonth;
  const attendantPerOrderBrl = ((salaryCents / 100) * (1 + charges / 100)) / ordersPerMonth;

  return {
    kind: 'ok',
    ordersPerMonth,
    aiPerOrderBrl,
    infraPerOrderBrl,
    attendantPerOrderBrl,
    savingsPercent: (1 - (aiPerOrderBrl + infraPerOrderBrl) / attendantPerOrderBrl) * 100
  };
};

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

export const todayInSaoPaulo = () => SAO_PAULO_DAY.format(new Date());

/**
 * `YYYY-MM-DD` moved by whole days.
 */
export const addDays = (date: string, days: number) => {
  const moved = new Date(`${date}T12:00:00.000Z`);

  moved.setUTCDate(moved.getUTCDate() + days);

  return moved.toISOString().slice(0, 10);
};
