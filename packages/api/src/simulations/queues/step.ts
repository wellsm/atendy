import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { InboundQueue } from '../../conversations/queues/inbound';
import type { Db, DbClient } from '../../db';
import type { SimulationStep } from '../provider';
import type { Scenario } from '../types';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { ConversationMode } from '../../conversations/types';
import { storefrontUrl } from '../../storefront/url';
import { formatLocationBody } from '../../whatsapp/location';
import { ParsedEventKind } from '../../whatsapp/types';
import { countBotReplies, evaluateChecks } from '../checks';
import { SimulatedCustomer } from '../customer';
import { judgeTranscript } from '../judge';
import { SIMULATED_JID_SUFFIX, SimulationRepository } from '../repository';
import { SimulationStatus } from '../types';

/**
 * Scripted batches may send the scenario's pin with this token.
 */
export const LOCATION_TOKEN = '{location}';

/**
 * One step of a simulated customer: queued when a run starts and after every bot reply (simulator provider).
 */
export declare class SimulationQueue extends Queue.Unordered<SimulationStep> {
  timeout: 60;

  deadLetter: Queue.UseDeadLetter<{
    maxAttempts: 3;
  }>;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof simulationStepHandler;
    }>
  ];

  variables: {
    OPENROUTER_API_KEY: Environment.Variable<'OPENROUTER_API_KEY'>;
    WEB_BASE_URL: Environment.Variable<'WEB_BASE_URL'>;
  };

  services: {
    db: Environment.Service<Db>;
    inboundQueue: Environment.Service<InboundQueue>;
    variables: Environment.ServiceVariables;
  };
}

type Simulation = NonNullable<Awaited<ReturnType<typeof SimulationRepository.load>>>;

const pinBody = (scenario: Scenario) => {
  const { location } = scenario.facts;

  return location ? formatLocationBody({ latitude: location.lat, longitude: location.lng }) : undefined;
};

/**
 * Runs the checks (and the judge) on the finished conversation and stores the result.
 */
const finish = async (
  db: DbClient,
  variables: { OPENROUTER_API_KEY: string; WEB_BASE_URL: string },
  simulation: Simulation
) => {
  const { scenario, conversation_id: conversationId } = simulation;

  const [facts, store, transcript] = await Promise.all([
    SimulationRepository.facts(db, conversationId ?? null),
    db.stores.findOne({ select: { slug: true }, where: { id: simulation.store_id } }),
    conversationId ? SimulationRepository.transcript(db, conversationId) : Promise.resolve([])
  ]);

  const checks = evaluateChecks(scenario.expect, facts, storefrontUrl(variables.WEB_BASE_URL, store?.slug ?? ''));

  const judge = await judgeTranscript({
    apiKey: variables.OPENROUTER_API_KEY,
    questions: scenario.expect.judge,
    transcript
  });

  const all = [...checks, ...judge.checks];

  await SimulationRepository.finish(db, {
    simulationId: simulation.id,
    runId: simulation.run_id,
    status: all.every(({ pass }) => pass) ? SimulationStatus.Passed : SimulationStatus.Failed,
    checks: all,
    judgeCostUsd: judge.costUsd,
    error: null
  });
};

/**
 * Next customer batch: the script's, the opening, or the customer model's (undefined = the customer is done).
 */
const nextBatch = async (
  apiKey: string,
  simulation: Simulation,
  transcript: Awaited<ReturnType<typeof SimulationRepository.transcript>>
) => {
  const { scenario, turns } = simulation;

  if (scenario.messages) {
    const batch = scenario.messages[turns];
    const pin = pinBody(scenario);

    return { batch: batch?.map((text) => (text === LOCATION_TOKEN && pin ? pin : text)), costUsd: 0 };
  }

  if (turns === 0 && scenario.opening.length) {
    return { batch: scenario.opening, costUsd: 0 };
  }

  const { turn, costUsd } = await SimulatedCustomer.next({
    apiKey,
    model: simulation.customerModel,
    scenario,
    transcript
  });
  const pin = turn.location ? pinBody(scenario) : undefined;
  const batch = [...turn.messages, ...(pin ? [pin] : [])];

  return { batch: turn.done || !batch.length ? undefined : batch, costUsd };
};

export async function simulationStepHandler(
  request: Queue.Incoming<SimulationStep>,
  { db, inboundQueue, variables }: Service.Context<SimulationQueue>
) {
  const simulation = await SimulationRepository.load(db, request.message.simulationId);

  if (!simulation || simulation.status !== SimulationStatus.Running) {
    return;
  }

  const { scenario, conversation_id: conversationId } = simulation;

  try {
    const [transcript, conversation] = conversationId
      ? await Promise.all([
          SimulationRepository.transcript(db, conversationId),
          db.conversations.findOne({ select: { mode: true, approval_reason: true }, where: { id: conversationId } })
        ])
      : [[], undefined];

    // With a person (or waiting for the store's approval) the bot is done, even when it sent nothing more.
    if (conversation?.mode === ConversationMode.Human || conversation?.approval_reason) {
      await finish(db, variables, simulation);
      return;
    }

    // Duplicate or early step: the bot has not answered every batch yet (one answer may be several messages).
    if (countBotReplies(transcript) < simulation.turns) {
      return;
    }

    if (simulation.turns >= scenario.maxTurns) {
      await finish(db, variables, simulation);
      return;
    }

    const { batch, costUsd } = await nextBatch(variables.OPENROUTER_API_KEY, simulation, transcript);
    const customerCostUsd = Number(simulation.customer_cost_usd) + costUsd;

    if (!batch) {
      await SimulationRepository.addCustomerCost(db, { simulationId: simulation.id, customerCostUsd });
      await finish(db, variables, simulation);
      return;
    }

    const name = typeof scenario.facts['name'] === 'string' ? scenario.facts['name'] : undefined;
    let ingestedConversationId = conversationId ?? '';

    // Deterministic ids: a retried or duplicated step stores and queues nothing twice.
    for (const [index, text] of batch.entries()) {
      const providerMessageId = `sim:${simulation.id}:${simulation.turns}:${index}`;

      const ingested = await ConversationRepository.ingestCustomerMessage(db, {
        storeId: simulation.store_id,
        message: {
          kind: ParsedEventKind.Message,
          instance: 'simulator',
          providerMessageId,
          fromMe: false,
          jid: `${simulation.phone}${SIMULATED_JID_SUFFIX}`,
          phone: simulation.phone,
          ...(name && { pushName: name }),
          text,
          sentAt: new Date().toISOString()
        }
      });

      ingestedConversationId = ingested.conversationId;

      if (!ingested.processed) {
        await inboundQueue.sendMessage({
          conversationId: ingested.conversationId,
          eventId: providerMessageId,
          kind: InboundEventKind.Customer,
          messageId: ingested.messageId
        });
      }
    }

    await SimulationRepository.recordTurn(db, {
      simulationId: simulation.id,
      conversationId: ingestedConversationId,
      turns: simulation.turns + 1,
      customerCostUsd
    });
  } catch (error) {
    if (request.attempt < request.maxAttempts) {
      throw error;
    }

    await SimulationRepository.finish(db, {
      simulationId: simulation.id,
      runId: simulation.run_id,
      status: SimulationStatus.Error,
      checks: null,
      judgeCostUsd: 0,
      error: error instanceof Error ? error.message : 'unknown'
    });
  }
}
