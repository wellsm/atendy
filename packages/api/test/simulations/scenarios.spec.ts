import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DEFAULT_MAX_TURNS, MAX_SIMULATIONS_PER_RUN, parseScenarios } from '../../src/simulations/scenarios';
import { SimulationOutcome } from '../../src/simulations/types';

const scenario = (fields: Record<string, unknown>) => ({
  id: 'pedido',
  title: 'Pedido',
  goal: '1 pizza',
  expect: { outcome: 'placed' },
  ...fields
});

const parse = (scenarios: unknown[], extra: Record<string, unknown> = {}) =>
  parseScenarios(JSON.stringify({ version: 1, ...extra, scenarios }));

describe('simulation scenarios', () => {
  it('accepts the first scenario set in the docs', () => {
    const source = readFileSync(new URL('../../../../docs/specs/simulation-scenarios.yaml', import.meta.url), 'utf8');
    const { scenarios, errors } = parseScenarios(source);

    deepEqual(errors, []);
    ok(scenarios.length >= 15);
  });

  it('normalizes YAML: defaults, single strings and outcome lists', () => {
    const { scenarios, errors } = parseScenarios(`
defaults:
  max_turns: 8
scenarios:
  - id: menu-link
    title: Cardápio
    messages:
      - oi, me manda o cardápio?
      - [valeu, tchau]
    expect:
      outcome: [none, handoff]
      bot_contains: '{menu_url}'
      items:
        - { product: Pizza Broto, options: Calabresa }
`);

    deepEqual(errors, []);

    const [menu] = scenarios;

    deepEqual(menu!.messages, [['oi, me manda o cardápio?'], ['valeu', 'tchau']]);
    equal(menu!.maxTurns, 8);
    equal(menu!.repeat, 1);
    deepEqual(menu!.expect.outcome, [SimulationOutcome.None, SimulationOutcome.Handoff]);
    deepEqual(menu!.expect.botContains, ['{menu_url}']);
    deepEqual(menu!.expect.items, [{ product: 'Pizza Broto', options: ['Calabresa'], qty: 1 }]);
  });

  it('uses the default max turns without defaults', () => {
    equal(parse([scenario({})]).scenarios[0]!.maxTurns, DEFAULT_MAX_TURNS);
  });

  it('reports every error with its path and returns no scenario', () => {
    const { scenarios, errors } = parse([
      scenario({ id: 'Pedido Ruim', messages: [['oi']] }),
      scenario({ expect: { outcome: 'won' }, repeat: 0, facts: { location: { lat: 'x' } } }),
      { id: 'sem-expect', title: 'X', goal: 'y' }
    ]);

    deepEqual(scenarios, []);
    deepEqual(
      errors.map(({ path }) => path),
      [
        'scenarios[0].id',
        'scenarios[0]',
        'scenarios[1].facts.location',
        'scenarios[1].repeat',
        'scenarios[1].expect.outcome',
        'scenarios[2].expect'
      ]
    );
  });

  it('refuses repeated ids and runs above the limit', () => {
    const { errors } = parse([scenario({}), scenario({ repeat: 10 })]);

    deepEqual(
      errors.map(({ path }) => path),
      ['scenarios[1].id']
    );

    const many = Array.from({ length: 6 }, (_, index) => scenario({ id: `s-${index}`, repeat: 10 }));

    ok(parse(many).errors.some(({ message }) => message.includes(String(MAX_SIMULATIONS_PER_RUN))));
  });

  it('reports invalid YAML with its line', () => {
    const { errors } = parseScenarios('scenarios:\n  - id: [a\n');

    equal(errors.length, 1);
    ok(errors[0]!.path.startsWith('linha'));
  });
});
