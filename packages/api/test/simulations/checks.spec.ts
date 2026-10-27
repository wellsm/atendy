import type { SimulationFacts } from '../../src/simulations/checks';
import type { ScenarioExpect } from '../../src/simulations/types';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Fulfillment } from '../../src/orders/types';
import { evaluateChecks } from '../../src/simulations/checks';
import { SimulationOutcome } from '../../src/simulations/types';
import { PaymentMethod } from '../../src/stores/types';

const expect = (fields: Partial<ScenarioExpect>): ScenarioExpect => ({
  outcome: [SimulationOutcome.Placed],
  handoffReason: null,
  items: null,
  fulfillment: null,
  payment: null,
  totalCents: null,
  billingPercent: null,
  botContains: [],
  botNotContains: [],
  maxBotMessages: null,
  judge: [],
  ...fields
});

const facts: SimulationFacts = {
  outcome: SimulationOutcome.Placed,
  handoffReason: null,
  order: {
    items: [
      { product: 'Pizza Grande', options: ['Catupiry', 'Calabresa'], qty: 1 },
      { product: 'Coca-Cola 2L', options: [], qty: 1 },
      { product: 'Coca-Cola 2L', options: [], qty: 1 }
    ],
    fulfillment: Fulfillment.Pickup,
    payment: PaymentMethod.Pix,
    totalCents: 8790
  },
  billingPercent: 100,
  botMessages: ['Cardápio: http://web.test/pizzaria', 'Pedido confirmado!'],
  botReplies: 2
};

const results = (checks: { name: string; pass: boolean }[]) => checks.map(({ name, pass }) => [name, pass]);

describe('simulation checks', () => {
  it('passes a matching order regardless of line and option order or case', () => {
    const checks = evaluateChecks(
      expect({
        items: [
          { product: 'coca-cola 2l', options: [], qty: 2 },
          { product: 'Pizza Grande', options: ['Calabresa', 'Catupiry'], qty: 1 }
        ],
        fulfillment: Fulfillment.Pickup,
        payment: PaymentMethod.Pix,
        totalCents: 8790,
        billingPercent: 100,
        botContains: ['{menu_url}'],
        botNotContains: ['chocolate'],
        maxBotMessages: 2
      }),
      facts,
      'http://web.test/pizzaria'
    );

    deepEqual(results(checks), [
      ['outcome', true],
      ['items', true],
      ['fulfillment', true],
      ['payment', true],
      ['total_cents', true],
      ['billing_percent', true],
      ['bot_contains', true],
      ['bot_not_contains', true],
      ['max_bot_messages', true]
    ]);
  });

  it('fails what differs and shows expected and actual', () => {
    const checks = evaluateChecks(
      expect({
        outcome: [SimulationOutcome.Handoff],
        handoffReason: 'customer_asked',
        items: [{ product: 'Pizza Grande', options: ['Calabresa'], qty: 1 }],
        payment: PaymentMethod.Cash
      }),
      facts,
      'http://web.test/pizzaria'
    );

    deepEqual(results(checks), [
      ['outcome', false],
      ['handoff_reason', false],
      ['items', false],
      ['payment', false]
    ]);
    deepEqual(checks[3], { name: 'payment', pass: false, expected: 'cash', actual: 'pix' });
  });

  it('accepts any of several outcomes and fails order checks without an order', () => {
    const checks = evaluateChecks(
      expect({ outcome: [SimulationOutcome.None, SimulationOutcome.Handoff], totalCents: 100 }),
      { ...facts, outcome: SimulationOutcome.None, order: null },
      ''
    );

    deepEqual(results(checks), [
      ['outcome', true],
      ['total_cents', false]
    ]);
  });
});
