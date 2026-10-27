import type { DbClient } from '../db';
import type { SimulationFacts } from './checks';
import type { TranscriptMessage } from './customer';
import type {
  ConversationSimulation,
  Scenario,
  SimulationCheck,
  SimulationRun,
  SimulationRunDetail,
  SimulationRunRow
} from './types';
import type { RouterType } from '../stores/types';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { countBotReplies } from './checks';
import { SimulationOutcome, SimulationStatus } from './types';
import { ConversationMode, MessageDirection } from '../conversations/types';
import { OrderStatus } from '../orders/types';

/**
 * A running simulation with no step for this long is marked as an error (the bot never answered).
 */
export const STALE_SIMULATION_MS = 5 * 60_000;

/**
 * Reply JID suffix of simulated customers: the inbound queue sends to them through the simulator provider.
 */
export const SIMULATED_JID_SUFFIX = '@sim';

export const isSimulatedJid = (jid: string) => jid.endsWith(SIMULATED_JID_SUFFIX);

/**
 * Fake phone of one simulation, unique per run and index (`5599` never is a real Brazilian area code).
 */
export const simulatedPhone = (runId: string, index: number) =>
  `5599${parseInt(runId.slice(0, 7), 16).toString().padStart(9, '0').slice(-9)}${String(index).padStart(4, '0')}`;

const RUNS_PAGE_SIZE = 30;

const sum = (values: number[]) => values.reduce((total, value) => total + Number(value), 0);

export namespace SimulationRepository {
  export const createRun = async (
    db: DbClient,
    input: {
      store: { id: string; router: RouterType; llm_model: string };
      name: string;
      source: string;
      scenarios: Scenario[];
      promptVersion: string;
      customerModel: string;
      createdBy: string;
    }
  ) => {
    const runId = randomUUID();
    const now = new Date().toISOString();

    const simulations = input.scenarios.flatMap((scenario) =>
      Array.from({ length: scenario.repeat }, (_, repeatIndex) => ({ scenario, repeatIndex }))
    );

    await db.simulation_runs.insertOne({
      data: {
        id: runId,
        store_id: input.store.id,
        name: input.name,
        source: input.source,
        total: simulations.length,
        prompt_version: input.promptVersion,
        router: input.store.router,
        llm_model: input.store.llm_model,
        customer_model: input.customerModel,
        created_by: input.createdBy,
        created_at: now
      }
    });

    const rows = simulations.map(({ scenario, repeatIndex }, index) => ({
      id: randomUUID(),
      run_id: runId,
      store_id: input.store.id,
      scenario_id: scenario.id,
      scenario: JSON.stringify(scenario),
      repeat_index: repeatIndex,
      phone: simulatedPhone(runId, index),
      status: SimulationStatus.Running,
      turns: 0,
      customer_cost_usd: 0,
      judge_cost_usd: 0,
      created_at: now,
      updated_at: now
    }));

    await db.simulations.insertMany({ data: rows });

    return { runId, simulationIds: rows.map(({ id }) => id) };
  };

  export const load = async (db: DbClient, simulationId: string) => {
    const simulation = await db.simulations.findOne({
      select: {
        id: true,
        run_id: true,
        store_id: true,
        scenario: true,
        phone: true,
        conversation_id: true,
        status: true,
        turns: true,
        customer_cost_usd: true
      },
      where: { id: simulationId }
    });

    if (!simulation) {
      return undefined;
    }

    const run = await db.simulation_runs.findOne({
      select: { customer_model: true },
      where: { id: simulation.run_id }
    });

    return {
      ...simulation,
      scenario: JSON.parse(simulation.scenario) as Scenario,
      customerModel: run?.customer_model ?? ''
    };
  };

  export const findIdByConversation = async (db: DbClient, conversationId: string) => {
    const {
      records: [simulation]
    } = await db.simulations.findMany({
      select: { id: true },
      where: { conversation_id: conversationId },
      take: 1
    });

    return simulation?.id;
  };

  /**
   * The simulation that produced a conversation, if any, with its scenario and result.
   */
  export const findByConversation = async (
    db: DbClient,
    conversationId: string
  ): Promise<ConversationSimulation | undefined> => {
    const {
      records: [simulation]
    } = await db.simulations.findMany({
      select: {
        id: true,
        run_id: true,
        scenario_id: true,
        scenario: true,
        repeat_index: true,
        status: true,
        turns: true,
        checks: true,
        customer_cost_usd: true,
        judge_cost_usd: true,
        error: true
      },
      where: { conversation_id: conversationId },
      take: 1
    });

    if (!simulation) {
      return undefined;
    }

    const run = await db.simulation_runs.findOne({
      select: { name: true, customer_model: true },
      where: { id: simulation.run_id }
    });

    const scenario = JSON.parse(simulation.scenario) as Scenario;

    return {
      id: simulation.id,
      runId: simulation.run_id,
      runName: run?.name ?? '',
      scenarioId: simulation.scenario_id,
      title: scenario.title,
      persona: scenario.persona,
      goal: scenario.goal,
      facts: JSON.stringify(scenario.facts),
      repeatIndex: simulation.repeat_index,
      status: simulation.status,
      turns: simulation.turns,
      checks: simulation.checks ?? [],
      error: simulation.error ?? null,
      customerModel: run?.customer_model ?? '',
      customerCostUsd: Number(simulation.customer_cost_usd),
      judgeCostUsd: Number(simulation.judge_cost_usd)
    };
  };

  /**
   * Conversation messages oldest first, as the customer model and the judge read them.
   */
  export const transcript = async (db: DbClient, conversationId: string): Promise<TranscriptMessage[]> => {
    const { records } = await db.messages.findMany({
      select: { direction: true, body: true },
      where: { conversation_id: conversationId },
      order: { created_at: Order.Asc }
    });

    return records.map(({ direction, body }) => ({ fromCustomer: direction === MessageDirection.In, body }));
  };

  export const recordTurn = async (
    db: DbClient,
    input: { simulationId: string; conversationId: string; turns: number; customerCostUsd: number }
  ) => {
    await db.simulations.updateOne({
      data: {
        conversation_id: input.conversationId,
        turns: input.turns,
        customer_cost_usd: input.customerCostUsd,
        updated_at: new Date().toISOString()
      },
      where: { id: input.simulationId }
    });
  };

  export const addCustomerCost = async (db: DbClient, input: { simulationId: string; customerCostUsd: number }) => {
    await db.simulations.updateOne({
      data: { customer_cost_usd: input.customerCostUsd, updated_at: new Date().toISOString() },
      where: { id: input.simulationId }
    });
  };

  /**
   * What the conversation produced: outcome, the placed order (else the draft), billing and bot messages.
   */
  export const facts = async (db: DbClient, conversationId: string | null): Promise<SimulationFacts> => {
    if (!conversationId) {
      return {
        outcome: SimulationOutcome.None,
        handoffReason: null,
        order: null,
        billingPercent: null,
        botMessages: [],
        botReplies: 0
      };
    }

    const [conversation, { records: orders }, { records: billing }, { records: messages }] = await Promise.all([
      db.conversations.findOne({
        select: { mode: true, handoff_reason: true, approval_reason: true },
        where: { id: conversationId }
      }),
      db.orders.findMany({
        select: {
          id: true,
          status: true,
          fulfillment: true,
          payment_method: true,
          total_cents: true
        },
        where: { conversation_id: conversationId },
        order: { created_at: Order.Desc }
      }),
      db.billing_records.findMany({ select: { percent: true }, where: { conversation_id: conversationId } }),
      db.messages.findMany({
        select: { direction: true, body: true },
        where: { conversation_id: conversationId },
        order: { created_at: Order.Asc }
      })
    ]);

    const placed = orders.find(({ status }) => status !== OrderStatus.Draft && status !== OrderStatus.Canceled);
    const order = placed ?? orders.find(({ status }) => status === OrderStatus.Draft);

    const { records: items } = order
      ? await db.order_items.findMany({
          select: { product_name: true, qty: true, options_snapshot: true },
          where: { order_id: order.id }
        })
      : { records: [] };

    // Waiting for the store's approval counts as a handoff: the bot stopped and a person decides.
    const handoff = conversation?.mode === ConversationMode.Human || !!conversation?.approval_reason;

    return {
      outcome: handoff ? SimulationOutcome.Handoff : placed ? SimulationOutcome.Placed : SimulationOutcome.None,
      handoffReason: conversation?.handoff_reason ?? conversation?.approval_reason ?? null,
      order: order
        ? {
            items: items.map(({ product_name, qty, options_snapshot }) => ({
              product: product_name,
              qty,
              options: options_snapshot.flatMap(({ options }) => options.map(({ name }) => name))
            })),
            fulfillment: order.fulfillment ?? null,
            payment: order.payment_method ?? null,
            totalCents: order.total_cents
          }
        : null,
      billingPercent: billing.length ? Math.max(...billing.map(({ percent }) => percent)) : null,
      botMessages: messages.filter(({ direction }) => direction === MessageDirection.Out).map(({ body }) => body),
      botReplies: countBotReplies(
        messages.map(({ direction }) => ({ fromCustomer: direction === MessageDirection.In }))
      )
    };
  };

  export const finish = async (
    db: DbClient,
    input: {
      simulationId: string;
      runId: string;
      status: SimulationStatus;
      checks: SimulationCheck[] | null;
      judgeCostUsd: number;
      error: string | null;
    }
  ) => {
    const now = new Date().toISOString();

    await db.simulations.updateOne({
      data: {
        status: input.status,
        checks: input.checks,
        judge_cost_usd: input.judgeCostUsd,
        error: input.error,
        updated_at: now,
        finished_at: now
      },
      where: { id: input.simulationId }
    });

    await finishRunIfDone(db, input.runId);
  };

  const finishRunIfDone = async (db: DbClient, runId: string) => {
    const running = await db.simulations.count({ where: { run_id: runId, status: SimulationStatus.Running } });

    if (!running) {
      await db.simulation_runs.updateOne({
        data: { finished_at: new Date().toISOString() },
        where: { id: runId, finished_at: null }
      });
    }
  };

  /**
   * Running simulations without a step for `STALE_SIMULATION_MS` become errors (the bot never answered).
   */
  export const expireStale = async (db: DbClient, runId: string) => {
    const before = new Date(Date.now() - STALE_SIMULATION_MS).toISOString();
    const now = new Date().toISOString();

    const { records } = await db.simulations.findMany({
      select: { id: true },
      where: { run_id: runId, status: SimulationStatus.Running, updated_at: { lt: before } }
    });

    if (!records.length) {
      return;
    }

    await db.simulations.updateMany({
      data: { status: SimulationStatus.Error, error: 'no_reply', updated_at: now, finished_at: now },
      where: { id: { isIn: records.map(({ id }) => id) } }
    });

    await finishRunIfDone(db, runId);
  };

  export const listRuns = async (db: DbClient): Promise<SimulationRunRow[]> => {
    const { records: runs } = await db.simulation_runs.findMany({
      select: RUN_FIELDS,
      order: { created_at: Order.Desc },
      take: RUNS_PAGE_SIZE
    });

    if (!runs.length) {
      return [];
    }

    const [{ records: simulations }, { records: stores }] = await Promise.all([
      db.simulations.findMany({
        select: { run_id: true, status: true },
        where: { run_id: { isIn: runs.map(({ id }) => id) } }
      }),
      db.stores.findMany({
        select: { id: true, name: true },
        where: { id: { isIn: [...new Set(runs.map(({ store_id }) => store_id))] } }
      })
    ]);

    const storeNames = new Map(stores.map(({ id, name }) => [id, name]));

    return runs.map((run) => {
      const statuses = simulations.filter(({ run_id }) => run_id === run.id).map(({ status }) => status);
      const count = (status: SimulationStatus) => statuses.filter((value) => value === status).length;

      return {
        ...toRun(run, storeNames.get(run.store_id) ?? ''),
        passed: count(SimulationStatus.Passed),
        failed: count(SimulationStatus.Failed),
        errors: count(SimulationStatus.Error),
        running: count(SimulationStatus.Running)
      };
    });
  };

  /**
   * One run with each simulation's result and costs: bot from `ai_calls`, billing from `billing_records`.
   */
  export const getRun = async (db: DbClient, runId: string): Promise<SimulationRunDetail | undefined> => {
    await expireStale(db, runId);

    const run = await db.simulation_runs.findOne({
      select: { ...RUN_FIELDS, source: true },
      where: { id: runId }
    });

    if (!run) {
      return undefined;
    }

    const [{ records: simulations }, store] = await Promise.all([
      db.simulations.findMany({
        select: {
          id: true,
          scenario_id: true,
          scenario: true,
          repeat_index: true,
          conversation_id: true,
          status: true,
          turns: true,
          checks: true,
          customer_cost_usd: true,
          judge_cost_usd: true,
          error: true,
          created_at: true,
          finished_at: true
        },
        where: { run_id: runId },
        order: { created_at: Order.Asc }
      }),
      db.stores.findOne({ select: { name: true }, where: { id: run.store_id } })
    ]);

    const conversationIds = simulations.flatMap(({ conversation_id }) => (conversation_id ? [conversation_id] : []));

    const [{ records: calls }, { records: billing }] = conversationIds.length
      ? await Promise.all([
          db.ai_calls.findMany({
            select: { conversation_id: true, cost_usd: true },
            where: { conversation_id: { isIn: conversationIds } }
          }),
          db.billing_records.findMany({
            select: { conversation_id: true, percent: true, amount_cents: true },
            where: { conversation_id: { isIn: conversationIds } }
          })
        ])
      : [{ records: [] }, { records: [] }];

    return {
      run: { ...toRun(run, store?.name ?? ''), source: run.source },
      simulations: simulations.map((simulation) => {
        const conversationId = simulation.conversation_id ?? null;
        const ownCalls = calls.filter(({ conversation_id }) => conversationId && conversation_id === conversationId);
        const billed = billing.filter(({ conversation_id }) => conversationId && conversation_id === conversationId);

        return {
          id: simulation.id,
          scenarioId: simulation.scenario_id,
          title: (JSON.parse(simulation.scenario) as Scenario).title,
          repeatIndex: simulation.repeat_index,
          conversationId,
          status: simulation.status,
          turns: simulation.turns,
          checks: simulation.checks ?? [],
          error: simulation.error ?? null,
          aiCalls: ownCalls.length,
          botCostUsd: sum(ownCalls.map(({ cost_usd }) => cost_usd)),
          customerCostUsd: Number(simulation.customer_cost_usd),
          judgeCostUsd: Number(simulation.judge_cost_usd),
          billingPercent: billed.length ? Math.max(...billed.map(({ percent }) => percent)) : null,
          billingCents: sum(billed.map(({ amount_cents }) => amount_cents)),
          createdAt: simulation.created_at,
          finishedAt: simulation.finished_at ?? null
        };
      })
    };
  };
}

const RUN_FIELDS = {
  id: true,
  store_id: true,
  name: true,
  total: true,
  prompt_version: true,
  router: true,
  llm_model: true,
  customer_model: true,
  created_at: true,
  finished_at: true
} as const;

const toRun = (
  run: {
    id: string;
    store_id: string;
    name: string;
    total: number;
    prompt_version: string;
    router: RouterType;
    llm_model: string;
    customer_model: string;
    created_at: string;
    finished_at?: string | null;
  },
  storeName: string
): SimulationRun => ({
  id: run.id,
  storeId: run.store_id,
  storeName,
  name: run.name,
  total: run.total,
  promptVersion: run.prompt_version,
  router: run.router,
  llmModel: run.llm_model,
  customerModel: run.customer_model,
  createdAt: run.created_at,
  finishedAt: run.finished_at ?? null
});
