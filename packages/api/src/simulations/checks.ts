import type { ScenarioExpect, ScenarioItem, SimulationCheck, SimulationOutcome } from './types';
import type { Fulfillment } from '../orders/types';
import type { PaymentMethod } from '../stores/types';

/**
 * What a finished simulated conversation produced, read from the database.
 */
export type SimulationFacts = {
  outcome: SimulationOutcome;
  handoffReason: string | null;
  /**
   * The placed order, else the draft; null without any.
   */
  order: {
    items: ScenarioItem[];
    fulfillment: Fulfillment | null;
    payment: PaymentMethod | null;
    totalCents: number;
  } | null;
  billingPercent: number | null;
  botMessages: string[];
  /**
   * Bot replies (`countBotReplies`): one reply may be several messages.
   */
  botReplies: number;
};

/**
 * Bot replies in a transcript: a reply is a run of bot messages (greeting, split answer, summary) between customer
 * messages.
 */
export const countBotReplies = (transcript: { fromCustomer: boolean }[]) => {
  return transcript.filter(
    ({ fromCustomer }, index) => !fromCustomer && (index === 0 || transcript[index - 1]!.fromCustomer)
  ).length;
};

export const MENU_URL_TOKEN = '{menu_url}';

const show = (value: unknown) => (value === null || value === undefined ? '—' : String(value));

/**
 * Same product and options (any order, any case) count as one line with the quantities summed.
 */
const itemsKey = (items: ScenarioItem[]) => {
  const lines = new Map<string, number>();

  for (const { product, options, qty } of items) {
    const key = [product, ...[...options].sort((a, b) => a.localeCompare(b))].join(' + ').toLocaleLowerCase('pt-BR');

    lines.set(key, (lines.get(key) ?? 0) + qty);
  }

  return [...lines.entries()]
    .map(([key, qty]) => `${qty}× ${key}`)
    .sort((a, b) => a.localeCompare(b))
    .join('; ');
};

const check = (name: string, expected: unknown, actual: unknown, pass = show(expected) === show(actual)) => ({
  name,
  pass,
  expected: show(expected),
  actual: show(actual)
});

/**
 * Deterministic checks of a scenario's `expect` against what the conversation produced. Judge questions run apart.
 */
export const evaluateChecks = (expect: ScenarioExpect, facts: SimulationFacts, menuUrl: string): SimulationCheck[] => {
  const checks: SimulationCheck[] = [
    check('outcome', expect.outcome.join(' | '), facts.outcome, expect.outcome.includes(facts.outcome))
  ];

  if (expect.handoffReason) {
    checks.push(check('handoff_reason', expect.handoffReason, facts.handoffReason));
  }

  if (expect.items) {
    checks.push(check('items', itemsKey(expect.items), facts.order ? itemsKey(facts.order.items) : null));
  }

  if (expect.fulfillment) {
    checks.push(check('fulfillment', expect.fulfillment, facts.order?.fulfillment));
  }

  if (expect.payment) {
    checks.push(check('payment', expect.payment, facts.order?.payment));
  }

  if (expect.totalCents !== null) {
    checks.push(check('total_cents', expect.totalCents, facts.order?.totalCents));
  }

  if (expect.billingPercent !== null) {
    checks.push(check('billing_percent', expect.billingPercent, facts.billingPercent));
  }

  const botText = facts.botMessages.join('\n');

  for (const text of expect.botContains) {
    const expected = text.replaceAll(MENU_URL_TOKEN, menuUrl);
    const found = botText.includes(expected);

    checks.push(check('bot_contains', expected, found ? expected : 'não encontrado', found));
  }

  for (const text of expect.botNotContains) {
    const expected = text.replaceAll(MENU_URL_TOKEN, menuUrl);
    const found = botText.includes(expected);

    checks.push(check('bot_not_contains', `sem "${expected}"`, found ? expected : `sem "${expected}"`, !found));
  }

  if (expect.maxBotMessages !== null) {
    const count = facts.botReplies;

    checks.push(check('max_bot_messages', `≤ ${expect.maxBotMessages}`, count, count <= expect.maxBotMessages));
  }

  return checks;
};
