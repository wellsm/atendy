import type { Db } from '../../src/db';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { AiRequestError } from '../../src/agent/errors';
import { JevClient } from '../../src/agent/jev-client';
import { TurnResponder } from '../../src/agent/turn';
import { AiProvider } from '../../src/agent/types';
import { handler as inboundHandler } from '../../src/conversations/queues/inbound';
import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode } from '../../src/conversations/types';
import { SimulatedCustomer } from '../../src/simulations/customer';
import { simulationStepHandler } from '../../src/simulations/queues/step';
import { SimulationRepository, STALE_SIMULATION_MS } from '../../src/simulations/repository';
import { parseScenarios } from '../../src/simulations/scenarios';
import { SimulationStatus } from '../../src/simulations/types';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { seedStore } from '../support/fixtures';

describe('simulation step', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const variables = {
    EVOLUTION_API_URL: 'http://evo',
    OPENROUTER_API_KEY: 'o',
    GOOGLE_MAPS_API_KEY: 'g',
    WEB_BASE_URL: 'http://web.test'
  };

  /**
   * Both queues as arrays: the test delivers their messages by hand.
   */
  const queues = () => {
    const inbound: Record<string, unknown>[] = [];
    const steps: { simulationId: string }[] = [];

    return {
      inbound,
      steps,
      inboundQueue: { sendMessage: (event: Record<string, unknown>) => (inbound.push(event), Promise.resolve()) },
      simulationQueue: { sendMessage: (step: { simulationId: string }) => (steps.push(step), Promise.resolve()) }
    };
  };

  type Queues = ReturnType<typeof queues>;

  const step = (q: Queues, simulationId: string, attempt = 1) =>
    simulationStepHandler(
      { message: { simulationId }, attempt, maxAttempts: 3 } as never,
      {
        db,
        inboundQueue: q.inboundQueue,
        variables
      } as never
    );

  /**
   * Delivers the queued inbound events (only the newest of a batch runs the turn).
   */
  const deliverInbound = async (q: Queues) => {
    for (const event of q.inbound.splice(0)) {
      await inboundHandler(
        { message: event, attempt: 1, maxAttempts: 3 } as never,
        {
          db,
          simulationQueue: q.simulationQueue,
          variables
        } as never
      );
    }
  };

  const startRun = async (storeId: string, source: string) => {
    const { scenarios, errors } = parseScenarios(source);

    deepEqual(errors, []);

    const store = await db.stores.findOne({
      select: { id: true, router: true, llm_model: true },
      where: { id: storeId }
    });

    return SimulationRepository.createRun(db, {
      store: store!,
      name: 'Teste',
      source,
      scenarios: scenarios,
      promptVersion: 'v-test',
      customerModel: 'openai/gpt-5.6-luna',
      createdBy: 'admin'
    });
  };

  const SCRIPTED = `
scenarios:
  - id: menu-link
    title: Cardápio
    messages:
      - [oi, me manda o cardápio?]
      - valeu
    expect:
      outcome: none
      bot_contains: '{menu_url}'
      max_bot_messages: 2
`;

  it('plays a scripted scenario through the real inbound queue and passes its checks', async () => {
    const { storeId } = await seedStore(db);
    const q = queues();
    const forStore = mock.method(WhatsAppProviders, 'forStore');
    const turn = mock.method(TurnResponder, 'respond', (input: { menuUrl: string }) =>
      Promise.resolve({ text: `Nosso cardápio: ${input.menuUrl}`, mutated: false })
    );

    const {
      simulationIds: [simulationId]
    } = await startRun(storeId, SCRIPTED);

    await step(q, simulationId!);

    equal(q.inbound.length, 2);

    // Early or duplicated step (the bot has not answered yet): nothing is sent again.
    await step(q, simulationId!);
    equal(q.inbound.length, 2);

    await deliverInbound(q);

    equal(turn.mock.callCount(), 1);
    equal(forStore.mock.callCount(), 0);
    deepEqual(q.steps, [{ simulationId }]);

    await step(q, q.steps.shift()!.simulationId);
    await deliverInbound(q);
    await step(q, q.steps.shift()!.simulationId);

    const detail = await SimulationRepository.getRun(db, (await SimulationRepository.load(db, simulationId!))!.run_id);
    const [result] = detail!.simulations;

    equal(result!.status, SimulationStatus.Passed);
    equal(result!.turns, 2);
    deepEqual(
      result!.checks.map(({ name, pass }) => [name, pass]),
      [
        ['outcome', true],
        ['bot_contains', true],
        ['max_bot_messages', true]
      ]
    );
    ok(detail!.run.finishedAt);

    const conversation = await db.conversations.findOne({
      select: { customer_id: true },
      where: { id: result!.conversationId! }
    });
    const customer = await db.customers.findOne({
      select: { whatsapp_jid: true, name: true },
      where: { id: conversation!.customer_id }
    });

    ok(customer!.whatsapp_jid.endsWith('@sim'));

    // The admin timeline finds the simulation by its conversation.
    const linked = await SimulationRepository.findByConversation(db, result!.conversationId!);

    equal(linked?.id, simulationId);
    equal(linked?.status, SimulationStatus.Passed);
    equal(linked?.checks.length, 3);
  });

  it('asks the customer model after the opening, ends on handoff and runs the judge', async () => {
    const { storeId } = await seedStore(db);
    const q = queues();

    mock.method(TurnResponder, 'respond', () => Promise.resolve({ text: 'O que vai ser?', mutated: false }));

    const customer = mock.method(SimulatedCustomer, 'next', () =>
      Promise.resolve({
        turn: { messages: ['quero falar com uma pessoa'], done: false, location: false },
        costUsd: 0.001
      })
    );

    const jev = mock.method(JevClient, 'evaluate', () =>
      Promise.resolve({
        model: 'jev',
        answers: { q0: { type: 'noul', noul: 0.9 } },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.0005 },
        latencyMs: 1
      })
    );

    const {
      simulationIds: [simulationId]
    } = await startRun(
      storeId,
      `
scenarios:
  - id: asks-human
    title: Atendente
    goal: pedir atendente
    opening: oi
    expect:
      outcome: handoff
      handoff_reason: customer_asked
      judge: O bot foi educado?
`
    );

    await step(q, simulationId!);
    await deliverInbound(q);

    equal(customer.mock.callCount(), 0);

    await step(q, q.steps.shift()!.simulationId);

    equal(customer.mock.callCount(), 1);
    equal((customer.mock.calls[0]!.arguments[0] as { model: string }).model, 'openai/gpt-5.6-luna');

    const simulation = await SimulationRepository.load(db, simulationId!);

    // The bot hands off (as the call_human tool does) and still sends its reply.
    await ConversationRepository.handOffToHuman(db, {
      conversationId: simulation!.conversation_id!,
      reason: 'customer_asked'
    });
    await deliverInbound(q);
    await step(q, simulationId!);

    const detail = await SimulationRepository.getRun(db, simulation!.run_id);
    const [result] = detail!.simulations;

    equal(jev.mock.callCount(), 1);
    equal(result!.status, SimulationStatus.Passed);
    equal(result!.customerCostUsd, 0.001);
    equal(result!.judgeCostUsd, 0.0005);
    deepEqual(
      result!.checks.map(({ name, pass }) => [name, pass]),
      [
        ['outcome', true],
        ['handoff_reason', true],
        ['judge', true]
      ]
    );

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: result!.conversationId! }
    });

    equal(conversation!.mode, ConversationMode.Human);
  });

  it('closes the simulation as an error after the last attempt fails', async () => {
    const { storeId } = await seedStore(db);
    const q = queues();

    mock.method(SimulatedCustomer, 'next', () =>
      Promise.reject(new AiRequestError('OpenRouter request failed (500)', AiProvider.OpenRouter, 500))
    );

    const {
      runId,
      simulationIds: [simulationId]
    } = await startRun(
      storeId,
      `
scenarios:
  - id: falha
    title: Falha
    goal: qualquer coisa
    expect: { outcome: none }
`
    );

    await step(q, simulationId!, 1).then(
      () => ok(false, 'should throw before the last attempt'),
      () => undefined
    );
    await step(q, simulationId!, 3);

    const [result] = (await SimulationRepository.getRun(db, runId))!.simulations;

    equal(result!.status, SimulationStatus.Error);
    equal(result!.error, 'OpenRouter request failed (500)');
  });

  it('expires simulations the bot never answered', async () => {
    const { storeId } = await seedStore(db);

    const { runId, simulationIds } = await startRun(storeId, SCRIPTED);

    await db.simulations.updateMany({
      data: { updated_at: new Date(Date.now() - STALE_SIMULATION_MS - 1000).toISOString() },
      where: { id: { isIn: simulationIds } }
    });

    const detail = await SimulationRepository.getRun(db, runId);

    equal(detail!.simulations[0]!.status, SimulationStatus.Error);
    equal(detail!.simulations[0]!.error, 'no_reply');
    ok(detail!.run.finishedAt);

    const [row] = (await SimulationRepository.listRuns(db)).filter(({ id }) => id === runId);

    deepEqual([row!.errors, row!.running], [1, 0]);
  });
});
