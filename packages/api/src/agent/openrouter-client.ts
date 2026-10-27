import { AiRequestError } from './errors';
import { AiProvider } from './types';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const TRANSCRIPTION_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

const REQUEST_TIMEOUT_MS = 20_000;

const TRANSCRIPTION_TIMEOUT_MS = 30_000;

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
      /**
       * Anthropic's raw content blocks, set only by `AnthropicClient`: thinking blocks must go back unchanged within a
       * tool loop, so the next round sends these instead of `content`/`tool_calls`.
       */
      blocks?: unknown[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type LlmTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ReasoningEffort = 'low' | 'medium' | 'high';

type TranscriptionResponse = {
  text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
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
    /**
     * For reasoning models; omitted, the model's default applies.
     */
    reasoningEffort?: ReasoningEffort;
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
          ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
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

  /**
   * Speech to text. `data` is the raw audio in base64 (not a data URI); the response always carries `usage.cost`.
   */
  export const transcribe = async (input: {
    apiKey: string;
    model: string;
    data: string;
    format: string;
    language: string;
  }) => {
    const started = Date.now();

    let response: Response;

    try {
      response = await fetch(TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          input_audio: { data: input.data, format: input.format },
          language: input.language
        }),
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';

      throw new AiRequestError(`OpenRouter transcription did not complete (${reason})`, AiProvider.OpenRouter, 0);
    }

    if (!response.ok) {
      throw new AiRequestError(
        `OpenRouter transcription failed (${response.status})`,
        AiProvider.OpenRouter,
        response.status
      );
    }

    const body = (await response.json().catch(() => ({}))) as TranscriptionResponse;

    return {
      text: body.text?.trim() ?? '',
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        costUsd: body.usage?.cost ?? 0
      },
      latencyMs: Date.now() - started
    };
  };
}
