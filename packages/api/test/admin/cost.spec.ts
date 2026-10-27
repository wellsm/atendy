import type { CostRow } from '../../src/admin/reports/cost';

import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateCost, parsePeriod, ReportPeriodError } from '../../src/admin/reports/cost';
import { AiPath, AiProvider } from '../../src/agent/types';

const row = (overrides: Partial<CostRow>): CostRow => ({
  provider: AiProvider.OpenRouter,
  path: AiPath.LlmFallback,
  model: 'anthropic/claude-haiku-5.5',
  input_tokens: 100,
  output_tokens: 10,
  cost_usd: 0.001,
  latency_ms: 1000,
  conversation_id: 'c1',
  prompt_version: 'v1',
  ...overrides
});

describe('cost report helpers', () => {
  it('turns Sao Paulo dates into an inclusive UTC range', () => {
    deepEqual(parsePeriod('2026-10-01', '2026-10-31'), {
      from: '2026-10-01',
      to: '2026-10-31',
      days: 31,
      startIso: '2026-10-01T03:00:00.000Z',
      endIso: '2026-11-01T02:59:59.999Z'
    });
    equal(parsePeriod('2026-10-13', '2026-10-13').days, 1);
  });

  it('refuses bad periods', () => {
    throws(() => parsePeriod('2026-10-02', '2026-10-01'), ReportPeriodError);
    throws(() => parsePeriod('2026-01-01', '2026-04-03'), ReportPeriodError);
    throws(() => parsePeriod('2026-13-01', '2026-13-02'), ReportPeriodError);
    throws(() => parsePeriod('2026-02-30', '2026-03-01'), ReportPeriodError);
    throws(() => parsePeriod('abc', '2026-10-01'), ReportPeriodError);
    equal(parsePeriod('2026-01-01', '2026-04-02').days, 92);
  });

  it('sums cost by provider, path and model', () => {
    const report = aggregateCost([
      row({ provider: AiProvider.Jev, path: AiPath.JevDirect, model: 'jev', cost_usd: 0.0002, latency_ms: 300 }),
      row({ path: AiPath.LlmReply, cost_usd: 0.0011, latency_ms: 900, conversation_id: 'c2' }),
      row({ provider: AiProvider.Jev, path: AiPath.LlmFallback, model: 'jev', cost_usd: 0.0002, latency_ms: 500 }),
      row({ cost_usd: 0.0031, latency_ms: 2000, input_tokens: 400, output_tokens: 50 })
    ]);

    equal(report.conversations, 2);
    equal(report.ai.totalUsd, 0.0046);
    deepEqual(report.ai.byProvider, [
      { provider: AiProvider.Jev, calls: 2, costUsd: 0.0004 },
      { provider: AiProvider.OpenRouter, calls: 2, costUsd: 0.0042 }
    ]);
    deepEqual(report.ai.byPath, [
      { path: AiPath.JevDirect, calls: 1, costUsd: 0.0002 },
      { path: AiPath.LlmFallback, calls: 2, costUsd: 0.0033 },
      { path: AiPath.LlmReply, calls: 1, costUsd: 0.0011 }
    ]);
    deepEqual(report.ai.byModel, [
      {
        model: 'anthropic/claude-haiku-5.5',
        provider: AiProvider.OpenRouter,
        calls: 2,
        inputTokens: 500,
        outputTokens: 60,
        costUsd: 0.0042,
        avgLatencyMs: 1450
      },
      {
        model: 'jev',
        provider: AiProvider.Jev,
        calls: 2,
        inputTokens: 200,
        outputTokens: 20,
        costUsd: 0.0004,
        avgLatencyMs: 400
      }
    ]);
    deepEqual(report.jev, { turns: 2, direct: 1 });
  });

  it('reports no Jev share without Jev rows, and zeros without rows', () => {
    equal(aggregateCost([row({})]).jev, null);
    deepEqual(aggregateCost([]), {
      conversations: 0,
      ai: { totalUsd: 0, byProvider: [], byPath: [], byModel: [], byPromptVersion: [] },
      jev: null
    });
  });

  it('sums decimals without float drift', () => {
    equal(aggregateCost(Array.from({ length: 10 }, () => row({ cost_usd: 0.1 }))).ai.totalUsd, 1);
  });

  it('aggregates a large period quickly', () => {
    const rows = Array.from({ length: 60_000 }, (_, index) =>
      row({ conversation_id: `c${index % 5000}`, cost_usd: 0.0001 })
    );

    const started = performance.now();
    const report = aggregateCost(rows);

    equal(report.ai.totalUsd, 6);
    equal(performance.now() - started < 1000, true);
  });

  it('sums cost by prompt version, old rows without one', () => {
    deepEqual(
      aggregateCost([
        row({ prompt_version: 'v1', cost_usd: 0.001 }),
        row({ prompt_version: 'v2', cost_usd: 0.002 }),
        row({ prompt_version: null, cost_usd: 0.004 }),
        row({ prompt_version: 'v1', cost_usd: 0.001 })
      ]).ai.byPromptVersion,
      [
        { version: null, calls: 1, costUsd: 0.004 },
        { version: 'v1', calls: 2, costUsd: 0.002 },
        { version: 'v2', calls: 1, costUsd: 0.002 }
      ]
    );
  });
});
