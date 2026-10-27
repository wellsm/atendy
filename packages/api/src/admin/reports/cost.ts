import { AiPath, AiProvider } from '../../agent/types';

export const MAX_REPORT_DAYS = 92;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Report dates are Sao Paulo days. Brazil has no daylight saving time since 2019, so the offset is fixed.
 */
const SAO_PAULO_OFFSET = '-03:00';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Costs are summed in nano-dollars (integers) so many small decimals never drift.
 */
const NANOS = 1e9;

export class ReportPeriodError extends Error {}

export type CostRow = {
  provider: AiProvider;
  path: AiPath;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  conversation_id: string;
  prompt_version: string | null;
};

export type AiCost = {
  totalUsd: number;
  byProvider: { provider: AiProvider; calls: number; costUsd: number }[];
  byPath: { path: AiPath; calls: number; costUsd: number }[];
  byModel: {
    model: string;
    provider: AiProvider;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number;
  }[];
  /**
   * `version: null` = calls logged before prompt versions existed.
   */
  byPromptVersion: { version: string | null; calls: number; costUsd: number }[];
};

const startOfDay = (date: string) => {
  if (!DATE_PATTERN.test(date)) {
    throw new ReportPeriodError('Dates must be YYYY-MM-DD.');
  }

  const start = new Date(`${date}T00:00:00.000${SAO_PAULO_OFFSET}`);

  // `Date` rolls invalid days over (Feb 30 → Mar 2); the day must come back unchanged.
  if (
    Number.isNaN(start.getTime()) ||
    new Date(start.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10) !== date
  ) {
    throw new ReportPeriodError(`Invalid date ${date}.`);
  }

  return start;
};

/**
 * Inclusive Sao Paulo days `from`..`to` as a UTC range, at most `MAX_REPORT_DAYS` long.
 */
export const parsePeriod = (from: string, to: string) => {
  const start = startOfDay(from);
  const end = new Date(startOfDay(to).getTime() + DAY_MS - 1);
  const days = Math.round((end.getTime() + 1 - start.getTime()) / DAY_MS);

  if (days < 1) {
    throw new ReportPeriodError('The end date is before the start date.');
  }

  if (days > MAX_REPORT_DAYS) {
    throw new ReportPeriodError(`At most ${MAX_REPORT_DAYS} days.`);
  }

  return { from, to, days, startIso: start.toISOString(), endIso: end.toISOString() };
};

const toNanos = (usd: number) => Math.round(Number(usd) * NANOS);

/**
 * Nano-dollars back to USD, rounded to 6 decimals.
 */
const toUsd = (nanos: number) => Math.round(nanos / 1e3) / 1e6;

const groupBy = <K extends string>(rows: CostRow[], key: (row: CostRow) => K) => {
  const groups = new Map<K, CostRow[]>();

  for (const row of rows) {
    const group = groups.get(key(row));

    if (group) {
      group.push(row);
    } else {
      groups.set(key(row), [row]);
    }
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const sumNanos = (rows: CostRow[]) => rows.reduce((total, row) => total + toNanos(row.cost_usd), 0);

const sum = (rows: CostRow[], value: (row: CostRow) => number) =>
  rows.reduce((total, row) => total + Number(value(row)), 0);

/**
 * Facts of the cost report from the AI calls of the period. The Jev share counts one Jev row per turn that tried Jev
 * (`jev_direct` = Jev decided alone).
 */
export const aggregateCost = (rows: CostRow[]) => {
  const jevRows = rows.filter(({ provider }) => provider === AiProvider.Jev);

  const ai: AiCost = {
    totalUsd: toUsd(sumNanos(rows)),
    byProvider: groupBy(rows, ({ provider }) => provider).map(([provider, group]) => ({
      provider,
      calls: group.length,
      costUsd: toUsd(sumNanos(group))
    })),
    byPath: groupBy(rows, ({ path }) => path).map(([path, group]) => ({
      path,
      calls: group.length,
      costUsd: toUsd(sumNanos(group))
    })),
    byModel: groupBy(rows, ({ model }) => model).map(([model, group]) => ({
      model,
      provider: group[0]!.provider,
      calls: group.length,
      inputTokens: sum(group, ({ input_tokens }) => input_tokens),
      outputTokens: sum(group, ({ output_tokens }) => output_tokens),
      costUsd: toUsd(sumNanos(group)),
      avgLatencyMs: Math.round(sum(group, ({ latency_ms }) => latency_ms) / group.length)
    })),
    // Empty key sorts first: rows without a version.
    byPromptVersion: groupBy(rows, ({ prompt_version }) => prompt_version ?? '').map(([version, group]) => ({
      version: version || null,
      calls: group.length,
      costUsd: toUsd(sumNanos(group))
    }))
  };

  return {
    conversations: new Set(rows.map(({ conversation_id }) => conversation_id)).size,
    ai,
    jev: jevRows.length
      ? { turns: jevRows.length, direct: jevRows.filter(({ path }) => path === AiPath.JevDirect).length }
      : null
  };
};
