import type { DbClient } from '../db';
import type { AiPath, AiProvider, AiToolTrace } from './types';

import { randomUUID } from 'node:crypto';

import { PROMPT_VERSION } from './prompt-version';

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
  /**
   * Logs the call as soon as it is paid for; returns its id so the tools it asked for can be attached after they run.
   */
  export const record = async (db: DbClient, input: AiCallInput) => {
    const id = randomUUID();

    await db.ai_calls.insertOne({
      data: {
        id,
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
        prompt_version: PROMPT_VERSION,
        tools: null,
        created_at: new Date().toISOString()
      }
    });

    return id;
  };

  export const setTools = async (db: DbClient, id: string, tools: AiToolTrace[]) => {
    await db.ai_calls.updateOne({ data: { tools }, where: { id } });
  };
}
