import type { Scenario } from '../../src/simulations/types';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { customerChat, parseCustomerTurn, SimulatedCustomer } from '../../src/simulations/customer';

const scenario = {
  id: 'pedido',
  title: 'Pedido',
  persona: 'apressado',
  goal: '1 pizza broto',
  messages: null,
  opening: [],
  facts: { name: 'Ana', location: { lat: -23.5, lng: -46.6 } },
  repeat: 1,
  maxTurns: 10,
  expect: {} as Scenario['expect']
} satisfies Scenario;

describe('simulated customer', () => {
  afterEach(() => mock.restoreAll());

  it('runs the chosen model, with low reasoning only where configured', async () => {
    const chat = mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content: '{"messages": ["oi"], "done": false}' },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.0002 },
        latencyMs: 1
      })
    );

    const luna = await SimulatedCustomer.next({ apiKey: 'k', model: 'openai/gpt-6-luna', scenario, transcript: [] });

    await SimulatedCustomer.next({ apiKey: 'k', model: 'anthropic/claude-haiku-5.5', scenario, transcript: [] });

    const [first, second] = chat.mock.calls.map(({ arguments: [input] }) => input as Record<string, unknown>);

    deepEqual([first!['model'], first!['reasoningEffort']], ['openai/gpt-6-luna', 'low']);
    deepEqual([second!['model'], 'reasoningEffort' in second!], ['anthropic/claude-haiku-5.5', false]);
    deepEqual(luna, { turn: { messages: ['oi'], done: false, location: false }, costUsd: 0.0002 });
  });

  it('reads the JSON answer, also inside extra text', () => {
    deepEqual(parseCustomerTurn('```json\n{"messages": ["oi", " "], "done": false, "location": true}\n```'), {
      messages: ['oi'],
      done: false,
      location: true
    });
    deepEqual(parseCustomerTurn('{"messages": [], "done": true}'), { messages: [], done: true, location: false });
  });

  it('treats plain text as one message', () => {
    deepEqual(parseCustomerTurn('quero uma broto'), { messages: ['quero uma broto'], done: false, location: false });
    deepEqual(parseCustomerTurn(null), { messages: [], done: false, location: false });
  });

  it('plays the customer as the assistant and the store as the user', () => {
    const chat = customerChat(scenario, [
      { fromCustomer: true, body: 'oi' },
      { fromCustomer: false, body: 'Olá! O que vai ser?' }
    ]);

    deepEqual(
      chat.map(({ role }) => role),
      ['system', 'assistant', 'user']
    );
    ok((chat[0]!.content as string).includes('1 pizza broto'));
    ok((chat[0]!.content as string).includes('"location": true'));
  });

  it('asks the model to open the conversation when there is no message yet', () => {
    const chat = customerChat(scenario, []);

    equal(chat.length, 2);
    equal(chat[1]!.role, 'user');
  });
});
