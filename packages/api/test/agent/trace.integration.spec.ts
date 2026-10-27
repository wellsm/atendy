import type { ToolCall } from '../../src/agent/openrouter-client';
import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { Order } from '@ez4/database';
import { DatabaseTester } from '@ez4/local-database/test';

import { LlmAgent } from '../../src/agent/llm';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { SYSTEM_PROMPT } from '../../src/agent/prompt';
import { PROMPT_VERSION } from '../../src/agent/prompt-version';
import { AiPath } from '../../src/agent/types';
import { seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('AI call traces', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const chatResult = (message: { content: string | null; tool_calls?: ToolCall[] }) => ({
    message: { role: 'assistant' as const, ...message },
    usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.0001 },
    latencyMs: 50
  });

  const call = (id: string, name: string, args: unknown): ToolCall => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  });

  const run = async (results: ReturnType<typeof chatResult>[]) => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const ctx: ToolContext = { db, storeId, conversationId, customerId, menu, mutated: false };

    mock.method(OpenRouterClient, 'chat', () => Promise.resolve(results.shift() ?? chatResult({ content: 'fim' })));

    await LlmAgent.run({
      ctx,
      apiKey: 'k',
      model: 'test/model',
      system: SYSTEM_PROMPT,
      state: '{}',
      path: AiPath.LlmFallback,
      tools: true
    });

    const { records } = await db.ai_calls.findMany({
      select: { prompt_version: true, tools: true, created_at: true },
      where: { conversation_id: conversationId },
      order: { created_at: Order.Asc }
    });

    return records;
  };

  it('stamps the prompt version and the tools each call asked for', async () => {
    const rows = await run([
      chatResult({ content: null, tool_calls: [call('c1', 'search_menu', { query: 'calabresa' })] }),
      chatResult({ content: 'Temos calabresa!' })
    ]);

    equal(rows.length, 2);
    equal(rows[0]?.prompt_version, PROMPT_VERSION);
    equal(rows[1]?.prompt_version, PROMPT_VERSION);
    deepEqual(rows[0]?.tools, [{ name: 'search_menu', args: { query: 'calabresa' }, ok: true }]);
    equal(rows[1]?.tools, null);
  });

  it('records a failing tool with its error code', async () => {
    const rows = await run([
      chatResult({ content: null, tool_calls: [call('c1', 'remove_item', { item_id: 'nope' })] }),
      chatResult({ content: 'Não achei esse item.' })
    ]);

    const [trace] = rows[0]?.tools ?? [];

    equal(trace?.name, 'remove_item');
    equal(trace?.ok, false);
    equal(typeof trace?.error, 'string');
  });
});
