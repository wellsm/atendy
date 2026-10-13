import type { DbClient } from '../db';
import type { AiPath, AiProvider } from './types';

import { randomUUID } from 'node:crypto';

export type AiCallInput = {
  storeId: string;
  conversationId: string;
  provider: AiProvider;
  model: string;
  path: AiPath;
  intent?: string | null;
  confidence?: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

export namespace AiCallRepository {
  export const record = async (db: DbClient, input: AiCallInput) => {
    await db.ai_calls.insertOne({
      data: {
        id: randomUUID(),
        store_id: input.storeId,
        conversation_id: input.conversationId,
        provider: input.provider,
        model: input.model,
        path: input.path,
        intent: input.intent ?? null,
        confidence: input.confidence ?? null,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        cost_usd: input.costUsd,
        latency_ms: Math.round(input.latencyMs),
        created_at: new Date().toISOString()
      }
    });
  };
}
