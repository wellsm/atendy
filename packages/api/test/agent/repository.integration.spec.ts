import type { Db } from '../../src/db';

import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { AiCallRepository } from '../../src/agent/repository';
import { AiPath, AiProvider } from '../../src/agent/types';
import { seedConversation, seedStore } from '../support/fixtures';

describe('AiCallRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('records an AI call with tokens, cost and latency', async () => {
    const { storeId } = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    await AiCallRepository.record(db, {
      storeId,
      conversationId,
      provider: AiProvider.Jev,
      model: 'jev-1.13.0',
      path: AiPath.JevDirect,
      intent: 'add_item',
      confidence: 0.91,
      inputTokens: 300,
      outputTokens: 20,
      costUsd: 0.0003,
      latencyMs: 412.7
    });

    const {
      records: [call]
    } = await db.ai_calls.findMany({
      select: {
        provider: true,
        path: true,
        intent: true,
        confidence: true,
        input_tokens: true,
        cost_usd: true,
        latency_ms: true
      },
      where: { conversation_id: conversationId }
    });

    equal(call?.provider, AiProvider.Jev);
    equal(call?.path, AiPath.JevDirect);
    equal(call?.intent, 'add_item');
    equal(Number(call?.confidence), 0.91);
    equal(call?.input_tokens, 300);
    equal(Number(call?.cost_usd), 0.0003);
    equal(call?.latency_ms, 413);
  });
});
