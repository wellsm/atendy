import type { Scenario, ScenarioExpect, ScenarioFacts, ScenarioItem } from './types';

import { load, YAMLException } from 'js-yaml';

import { SimulationOutcome } from './types';
import { Fulfillment } from '../orders/types';
import { PaymentMethod } from '../stores/types';

export const DEFAULT_MAX_TURNS = 14;

const MAX_TURNS_LIMIT = 30;

const MAX_REPEAT = 10;

/**
 * Simulations (scenarios × repeat) one run may start: they all run at once.
 */
export const MAX_SIMULATIONS_PER_RUN = 50;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const OUTCOMES: string[] = [SimulationOutcome.Placed, SimulationOutcome.Handoff, SimulationOutcome.None];

const FULFILLMENTS: string[] = [Fulfillment.Delivery, Fulfillment.Pickup];

const PAYMENTS: string[] = [PaymentMethod.Pix, PaymentMethod.Card, PaymentMethod.Cash];

export type ScenarioError = {
  path: string;
  message: string;
};

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/**
 * Reads one scenario file section by section, collecting every error (path + Portuguese message for the admin).
 */
class Reader {
  readonly errors: ScenarioError[] = [];

  fail(path: string, message: string) {
    this.errors.push({ path, message });
  }

  text(raw: Raw, key: string, path: string, required: boolean) {
    const value = raw[key];

    if (value === undefined || value === null) {
      if (required) {
        this.fail(`${path}.${key}`, 'obrigatório');
      }

      return null;
    }

    if (!isText(value)) {
      this.fail(`${path}.${key}`, 'deve ser um texto');
      return null;
    }

    return value.trim();
  }

  texts(raw: Raw, key: string, path: string) {
    const value = raw[key];

    if (value === undefined || value === null) {
      return [];
    }

    if (isText(value)) {
      return [value];
    }

    if (!isTextList(value)) {
      this.fail(`${path}.${key}`, 'deve ser um texto ou uma lista de textos');
      return [];
    }

    return value;
  }

  integer(raw: Raw, key: string, path: string, range: { min: number; max?: number }) {
    const value = raw[key];

    if (value === undefined || value === null) {
      return null;
    }

    if (!Number.isInteger(value) || (value as number) < range.min || (range.max && (value as number) > range.max)) {
      this.fail(`${path}.${key}`, `deve ser um inteiro entre ${range.min} e ${range.max ?? '∞'}`);
      return null;
    }

    return value as number;
  }

  oneOf<T extends string>(raw: Raw, key: string, path: string, allowed: string[]) {
    const value = raw[key];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || !allowed.includes(value)) {
      this.fail(`${path}.${key}`, `deve ser um de: ${allowed.join(', ')}`);
      return null;
    }

    return value as T;
  }
}

const readFacts = (reader: Reader, raw: Raw, path: string): ScenarioFacts => {
  const facts = raw['facts'];

  if (facts === undefined || facts === null) {
    return {};
  }

  if (!isObject(facts)) {
    reader.fail(`${path}.facts`, 'deve ser um objeto');
    return {};
  }

  const { location, ...rest } = facts;

  if (location === undefined || location === null) {
    return rest;
  }

  if (
    !isObject(location) ||
    typeof location['lat'] !== 'number' ||
    typeof location['lng'] !== 'number' ||
    Math.abs(location['lat']) > 90 ||
    Math.abs(location['lng']) > 180
  ) {
    reader.fail(`${path}.facts.location`, 'deve ter lat e lng numéricos');
    return rest;
  }

  return { ...rest, location: { lat: location['lat'], lng: location['lng'] } };
};

const readItems = (reader: Reader, raw: Raw, path: string): ScenarioItem[] | null => {
  const items = raw['items'];

  if (items === undefined || items === null) {
    return null;
  }

  if (!Array.isArray(items)) {
    reader.fail(`${path}.items`, 'deve ser uma lista');
    return null;
  }

  return items.flatMap((item, index) => {
    const itemPath = `${path}.items[${index}]`;

    if (!isObject(item)) {
      reader.fail(itemPath, 'deve ser um objeto');
      return [];
    }

    const product = reader.text(item, 'product', itemPath, true);
    const options = reader.texts(item, 'options', itemPath);
    const qty = reader.integer(item, 'qty', itemPath, { min: 1, max: 100 }) ?? 1;

    return product ? [{ product, options, qty }] : [];
  });
};

const readExpect = (reader: Reader, raw: Raw, path: string): ScenarioExpect | null => {
  const expect = raw['expect'];
  const expectPath = `${path}.expect`;

  if (!isObject(expect)) {
    reader.fail(expectPath, 'obrigatório (objeto)');
    return null;
  }

  const outcomes = reader.texts(expect, 'outcome', expectPath);

  if (!outcomes.length) {
    reader.fail(`${expectPath}.outcome`, 'obrigatório');
  }

  if (outcomes.some((outcome) => !OUTCOMES.includes(outcome))) {
    reader.fail(`${expectPath}.outcome`, `deve ser um de: ${OUTCOMES.join(', ')}`);
  }

  return {
    outcome: outcomes as SimulationOutcome[],
    handoffReason: reader.text(expect, 'handoff_reason', expectPath, false),
    items: readItems(reader, expect, expectPath),
    fulfillment: reader.oneOf<Fulfillment>(expect, 'fulfillment', expectPath, FULFILLMENTS),
    payment: reader.oneOf<PaymentMethod>(expect, 'payment', expectPath, PAYMENTS),
    totalCents: reader.integer(expect, 'total_cents', expectPath, { min: 0 }),
    billingPercent: reader.integer(expect, 'billing_percent', expectPath, { min: 0, max: 100 }),
    botContains: reader.texts(expect, 'bot_contains', expectPath),
    botNotContains: reader.texts(expect, 'bot_not_contains', expectPath),
    maxBotMessages: reader.integer(expect, 'max_bot_messages', expectPath, { min: 1 }),
    judge: reader.texts(expect, 'judge', expectPath)
  };
};

const readMessages = (reader: Reader, raw: Raw, path: string) => {
  const messages = raw['messages'];

  if (messages === undefined || messages === null) {
    return null;
  }

  if (!Array.isArray(messages) || !messages.length) {
    reader.fail(`${path}.messages`, 'deve ser uma lista não vazia');
    return null;
  }

  return messages.flatMap((batch, index) => {
    if (isText(batch)) {
      return [[batch]];
    }

    if (!isTextList(batch) || !batch.length) {
      reader.fail(`${path}.messages[${index}]`, 'deve ser um texto ou uma lista de textos');
      return [];
    }

    return [batch];
  });
};

const readScenario = (reader: Reader, raw: unknown, index: number, defaultMaxTurns: number): Scenario | null => {
  const path = `scenarios[${index}]`;

  if (!isObject(raw)) {
    reader.fail(path, 'deve ser um objeto');
    return null;
  }

  const id = reader.text(raw, 'id', path, true);

  if (id && !ID_PATTERN.test(id)) {
    reader.fail(`${path}.id`, 'use kebab-case (ex.: pedido-simples)');
  }

  const goal = reader.text(raw, 'goal', path, false);
  const messages = readMessages(reader, raw, path);

  if (!goal === !messages) {
    reader.fail(path, 'informe exatamente um de goal ou messages');
  }

  const scenario = {
    id: id ?? '',
    title: reader.text(raw, 'title', path, true) ?? '',
    persona: reader.text(raw, 'persona', path, false),
    goal,
    messages,
    opening: reader.texts(raw, 'opening', path),
    facts: readFacts(reader, raw, path),
    repeat: reader.integer(raw, 'repeat', path, { min: 1, max: MAX_REPEAT }) ?? 1,
    maxTurns: reader.integer(raw, 'max_turns', path, { min: 1, max: MAX_TURNS_LIMIT }) ?? defaultMaxTurns,
    expect: readExpect(reader, raw, path)
  };

  return scenario.expect ? { ...scenario, expect: scenario.expect } : null;
};

/**
 * Parses and validates a scenario file (YAML or JSON). Returns the scenarios only when there is no error.
 */
export const parseScenarios = (source: string): { scenarios: Scenario[]; errors: ScenarioError[] } => {
  let document: unknown;

  try {
    document = load(source);
  } catch (error) {
    if (error instanceof YAMLException) {
      return {
        scenarios: [],
        errors: [
          { path: error.mark ? `linha ${error.mark.line + 1}` : 'source', message: `YAML inválido: ${error.reason}` }
        ]
      };
    }

    throw error;
  }

  const reader = new Reader();

  if (!isObject(document) || !Array.isArray(document['scenarios']) || !document['scenarios'].length) {
    reader.fail('scenarios', 'obrigatório (lista não vazia)');
    return { scenarios: [], errors: reader.errors };
  }

  const defaults = isObject(document['defaults']) ? document['defaults'] : {};

  const defaultMaxTurns =
    reader.integer(defaults, 'max_turns', 'defaults', { min: 1, max: MAX_TURNS_LIMIT }) ?? DEFAULT_MAX_TURNS;

  const scenarios = document['scenarios'].flatMap((raw, index) => {
    const scenario = readScenario(reader, raw, index, defaultMaxTurns);

    return scenario ? [scenario] : [];
  });

  const seen = new Set<string>();

  scenarios.forEach(({ id }, index) => {
    if (id && seen.has(id)) {
      reader.fail(`scenarios[${index}].id`, `repetido: ${id}`);
    }

    seen.add(id);
  });

  const total = scenarios.reduce((sum, { repeat }) => sum + repeat, 0);

  if (total > MAX_SIMULATIONS_PER_RUN) {
    reader.fail(
      'scenarios',
      `no máximo ${MAX_SIMULATIONS_PER_RUN} conversas por rodada (cenários × repeat = ${total})`
    );
  }

  return reader.errors.length ? { scenarios: [], errors: reader.errors } : { scenarios, errors: [] };
};
