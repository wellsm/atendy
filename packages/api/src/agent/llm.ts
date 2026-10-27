import type { ChatMessage } from './openrouter-client';
import type { ToolContext, ToolResult } from './tools';
import type { AiPath, AiToolTrace } from './types';

import { AnthropicClient } from './anthropic-client';
import { AiRequestError } from './errors';
import { OpenRouterClient } from './openrouter-client';
import { AiCallRepository } from './repository';
import { executeTool, TOOL_DEFINITIONS } from './tools';
import { AiProvider } from './types';
import { anthropicModelId } from '../stores/models';

/**
 * Chat calls per turn. Each one is logged; the last one must be a text answer.
 */
export const MAX_TOOL_ROUNDS = 5;

export type LlmRunInput = {
  ctx: ToolContext;
  /**
   * OpenRouter key.
   */
  apiKey: string | undefined;
  /**
   * Used instead of `apiKey` when `model` is a direct Anthropic model (`anthropicModelId`).
   */
  anthropicApiKey?: string;
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

/**
 * What the admin inspector shows for one tool run.
 */
export const toolTrace = (name: string, args: unknown, output: ToolResult): AiToolTrace => ({
  name,
  args: isRecord(args) ? args : null,
  ok: output.ok,
  ...(!output.ok && { error: output.error })
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export namespace LlmAgent {
  export const run = async (input: LlmRunInput) => {
    const { ctx } = input;
    const directModel = anthropicModelId(input.model);
    const provider = directModel ? AiProvider.Anthropic : AiProvider.OpenRouter;
    const apiKey = directModel ? input.anthropicApiKey : input.apiKey;

    if (!apiKey) {
      throw new AiRequestError(`${directModel ? 'ANTHROPIC' : 'OPENROUTER'}_API_KEY is not set`, provider, 0);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.state }
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // The last round keeps the tools (the history has tool calls) but asks for a text answer.
      const lastRound = round === MAX_TOOL_ROUNDS - 1;

      const request = {
        apiKey,
        messages,
        ...(input.tools ? { tools: TOOL_DEFINITIONS } : {}),
        ...(input.tools && lastRound ? { toolChoice: 'none' as const } : {})
      };

      const result = directModel
        ? await AnthropicClient.chat({ ...request, model: directModel })
        : await OpenRouterClient.chat({ ...request, model: input.model });

      const callId = await AiCallRepository.record(ctx.db, {
        storeId: ctx.storeId,
        conversationId: ctx.conversationId,
        provider,
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
          throw new AiRequestError('The model returned an empty reply', provider, 200);
        }

        return text;
      }

      messages.push(result.message);

      const traces: AiToolTrace[] = [];

      for (const call of calls) {
        const args = parseArguments(call.function.arguments);
        const output = await executeTool(ctx, call.function.name, args);

        traces.push(toolTrace(call.function.name, args, output));
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }

      await AiCallRepository.setTools(ctx.db, callId, traces);

      // The store decides now: the reply would never be sent, so the model is not asked for it.
      if (ctx.awaitingApproval) {
        return '';
      }
    }

    throw new AiRequestError('Tool round limit reached', provider, 0);
  };
}
