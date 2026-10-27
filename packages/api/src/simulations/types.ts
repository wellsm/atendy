import type { Fulfillment } from '../orders/types';
import type { PaymentMethod, RouterType } from '../stores/types';

export const enum SimulationStatus {
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  Error = 'error'
}

export const enum SimulationOutcome {
  Placed = 'placed',
  Handoff = 'handoff',
  None = 'none'
}

export type ScenarioLocation = {
  lat: number;
  lng: number;
};

/**
 * What the simulated customer answers when the bot asks. Free-form for the customer model; `location` is also the pin.
 */
export type ScenarioFacts = Record<string, unknown> & {
  location?: ScenarioLocation;
};

export type ScenarioItem = {
  product: string;
  options: string[];
  qty: number;
};

export type ScenarioExpect = {
  /**
   * Accepted outcomes (any of them passes).
   */
  outcome: SimulationOutcome[];
  handoffReason: string | null;
  items: ScenarioItem[] | null;
  fulfillment: Fulfillment | null;
  payment: PaymentMethod | null;
  totalCents: number | null;
  billingPercent: number | null;
  botContains: string[];
  botNotContains: string[];
  maxBotMessages: number | null;
  /**
   * Yes/no questions about the transcript; "yes" passes.
   */
  judge: string[];
};

export type Scenario = {
  id: string;
  title: string;
  persona: string | null;
  /**
   * Customer model mode. Exactly one of `goal` or `messages`.
   */
  goal: string | null;
  /**
   * Scripted mode: one batch per customer turn.
   */
  messages: string[][] | null;
  /**
   * First batch of the customer model mode (the model writes it when empty).
   */
  opening: string[];
  facts: ScenarioFacts;
  repeat: number;
  maxTurns: number;
  expect: ScenarioExpect;
};

export type SimulationCheck = {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
};

export type SimulationRun = {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  total: number;
  promptVersion: string;
  router: RouterType;
  llmModel: string;
  customerModel: string;
  createdAt: string;
  finishedAt: string | null;
};

export type SimulationRunRow = SimulationRun & {
  passed: number;
  failed: number;
  errors: number;
  running: number;
};

export type SimulationResult = {
  id: string;
  scenarioId: string;
  title: string;
  repeatIndex: number;
  conversationId: string | null;
  status: SimulationStatus;
  turns: number;
  checks: SimulationCheck[];
  error: string | null;
  aiCalls: number;
  botCostUsd: number;
  customerCostUsd: number;
  judgeCostUsd: number;
  billingPercent: number | null;
  billingCents: number;
  createdAt: string;
  finishedAt: string | null;
};

/**
 * The simulation behind a conversation, for its timeline: scenario, result and run, enough to debug it.
 */
export type ConversationSimulation = {
  id: string;
  runId: string;
  runName: string;
  scenarioId: string;
  title: string;
  persona: string | null;
  goal: string | null;
  /**
   * Scenario facts as JSON text (free-form).
   */
  facts: string;
  repeatIndex: number;
  status: SimulationStatus;
  turns: number;
  checks: SimulationCheck[];
  error: string | null;
  customerModel: string;
  customerCostUsd: number;
  judgeCostUsd: number;
};

export type SimulationRunDetail = {
  run: SimulationRun & { source: string };
  simulations: SimulationResult[];
};
