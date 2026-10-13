import type { ChatMessage } from './openrouter-client';
import type { ToolContext } from './tools';
import type { AiPath } from './types';

import { AiRequestError } from './errors';
import { OpenRouterClient } from './openrouter-client';
import { AiCallRepository } from './repository';
import { executeTool, TOOL_DEFINITIONS } from './tools';
import { AiProvider } from './types';

/**
 * Chat calls per turn. Each one is logged; the last one must be a text answer.
 */
export const MAX_TOOL_ROUNDS = 5;

export type LlmRunInput = {
  ctx: ToolContext;
  apiKey: string | undefined;
  model: string;
  system: string;
  state: string;
  path: AiPath;
  /**
   * `false` for the cheap reply: no tools are offered and tool calls are ignored.
   */
  tools: boolean;
};

const parseArguments = (raw: string): unknown => {
  // Some models send "" for tools without parameters.
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export namespace LlmAgent {
  export const run = async (input: LlmRunInput) => {
    const { ctx, apiKey } = input;

    if (!apiKey) {
      throw new AiRequestError('OPENROUTER_API_KEY is not set', AiProvider.OpenRouter, 0);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.state }
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // The last round keeps the tools (the history has tool calls) but asks for a text answer.
      const lastRound = round === MAX_TOOL_ROUNDS - 1;

      const result = await OpenRouterClient.chat({
        apiKey,
        model: input.model,
        messages,
        ...(input.tools ? { tools: TOOL_DEFINITIONS } : {}),
        ...(input.tools && lastRound ? { toolChoice: 'none' as const } : {})
      });

      await AiCallRepository.record(ctx.db, {
        storeId: ctx.storeId,
        conversationId: ctx.conversationId,
        provider: AiProvider.OpenRouter,
        model: input.model,
        path: input.path,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: result.usage.costUsd,
        latencyMs: result.latencyMs
      });

      const calls = input.tools && !lastRound ? (result.message.tool_calls ?? []) : [];

      if (!calls.length) {
        const text = result.message.content?.trim();

        if (!text) {
          throw new AiRequestError('OpenRouter returned an empty reply', AiProvider.OpenRouter, 200);
        }

        return text;
      }

      messages.push(result.message);

      for (const call of calls) {
        const output = await executeTool(ctx, call.function.name, parseArguments(call.function.arguments));

        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }

    throw new AiRequestError('Tool round limit reached', AiProvider.OpenRouter, 0);
  };
}
