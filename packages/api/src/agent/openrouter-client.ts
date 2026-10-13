import { AiRequestError } from './errors';
import { AiProvider } from './types';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const REQUEST_TIMEOUT_MS = 20_000;

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type LlmTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type ChatResponse = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export namespace OpenRouterClient {
  /**
   * One chat completion. `usage: { include: true }` makes OpenRouter return the call cost in USD.
   */
  export const chat = async (input: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    tools?: LlmTool[];
    toolChoice?: 'none';
  }) => {
    const started = Date.now();

    let response: Response;

    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          ...(input.tools?.length ? { tools: input.tools } : {}),
          ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
          usage: { include: true }
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';

      throw new AiRequestError(`OpenRouter request did not complete (${reason})`, AiProvider.OpenRouter, 0);
    }

    if (!response.ok) {
      throw new AiRequestError(
        `OpenRouter request failed (${response.status})`,
        AiProvider.OpenRouter,
        response.status
      );
    }

    const body = (await response.json().catch(() => ({}))) as ChatResponse;

    const message = body.choices?.[0]?.message;

    if (!message) {
      throw new AiRequestError('OpenRouter response without a message', AiProvider.OpenRouter, response.status);
    }

    return {
      message: {
        role: 'assistant' as const,
        content: message.content ?? null,
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {})
      },
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        costUsd: body.usage?.cost ?? 0
      },
      latencyMs: Date.now() - started
    };
  };
}
