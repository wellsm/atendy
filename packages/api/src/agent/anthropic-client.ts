import type { ChatMessage, LlmTool, ToolCall } from './openrouter-client';

import { AiRequestError } from './errors';
import { AiProvider } from './types';
import { ANTHROPIC_PRICES } from '../stores/models';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const ANTHROPIC_VERSION = '2023-06-01';

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * WhatsApp replies and tool arguments are short; Anthropic requires a cap.
 */
const MAX_OUTPUT_TOKENS = 2048;

const EPHEMERAL = { type: 'ephemeral' } as const;

type CacheControl = typeof EPHEMERAL;

type AnthropicBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: unknown; cache_control?: CacheControl }
  | { type: 'tool_result'; tool_use_id: string; content: string; cache_control?: CacheControl }
  | { type: 'thinking' | 'redacted_thinking'; cache_control?: CacheControl };

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: unknown }
  | { type: 'thinking' | 'redacted_thinking' };

type MessagesResponse = {
  content?: ResponseBlock[];
  usage?: AnthropicUsage;
};

const parseInput = (raw: string): unknown => {
  try {
    const input: unknown = JSON.parse(raw);

    return typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
  } catch {
    return {};
  }
};

/**
 * OpenAI-shaped history (what `LlmAgent` keeps) to Anthropic's: system prompts apart, tool calls as `tool_use` blocks,
 * tool messages as `tool_result` blocks of one user message (consecutive same-role messages are merged).
 */
export const toAnthropicMessages = (messages: ChatMessage[]) => {
  const system: string[] = [];
  const converted: AnthropicMessage[] = [];

  const push = (role: AnthropicMessage['role'], block: AnthropicBlock) => {
    const last = converted.at(-1);

    if (last?.role === role) {
      last.content.push(block);
    } else {
      converted.push({ role, content: [block] });
    }
  };

  for (const message of messages) {
    switch (message.role) {
      case 'system':
        system.push(message.content);
        break;

      case 'user':
        push('user', { type: 'text', text: message.content });
        break;

      case 'tool':
        push('user', { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content });
        break;

      case 'assistant':
        // Haiku 5.5 thinks by default: its blocks (thinking included) go back exactly as Anthropic sent them.
        if (message.blocks) {
          for (const block of message.blocks) {
            // A copy: the cache breakpoint set below must not stick to the history kept by `LlmAgent`.
            push('assistant', { ...(block as AnthropicBlock) });
          }

          break;
        }

        if (message.content) {
          push('assistant', { type: 'text', text: message.content });
        }

        for (const call of message.tool_calls ?? []) {
          push('assistant', {
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: parseInput(call.function.arguments)
          });
        }
    }
  }

  return { system: system.join('\n\n'), messages: converted };
};

/**
 * Call cost in USD from the token counts and the price table (`input_tokens` excludes cache reads and writes).
 */
export const anthropicCost = (model: string, usage: AnthropicUsage) => {
  const price = ANTHROPIC_PRICES[model];

  if (!price) {
    return 0;
  }

  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const rates = price.long && input + cacheWrite + cacheRead > price.long.limit ? price.long : price;

  return (
    (input * rates.input +
      cacheWrite * rates.cacheWrite +
      cacheRead * rates.cacheRead +
      (usage.output_tokens ?? 0) * rates.output) /
    1_000_000
  );
};

export namespace AnthropicClient {
  /**
   * One Messages API call with the same input and output as `OpenRouterClient.chat`. The tools and the system prompt
   * are cached (they repeat on every call of a store); with tools, the history is cached too for the next tool round.
   */
  export const chat = async (input: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    tools?: LlmTool[];
    toolChoice?: 'none';
  }) => {
    const started = Date.now();
    const { system, messages } = toAnthropicMessages(input.messages);
    const tools = input.tools ?? [];

    if (tools.length) {
      const last = messages.at(-1)?.content.at(-1);

      if (last) {
        last.cache_control = EPHEMERAL;
      }
    }

    let response: Response;

    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': input.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: [{ type: 'text', text: system, cache_control: EPHEMERAL }],
          messages,
          ...(tools.length && {
            tools: tools.map(({ function: tool }) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters
            }))
          }),
          ...(input.toolChoice && { tool_choice: { type: input.toolChoice } })
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';

      throw new AiRequestError(`Anthropic request did not complete (${reason})`, AiProvider.Anthropic, 0);
    }

    if (!response.ok) {
      // Anthropic's error text names the cause (key scope, credit, request field paths), never the prompt itself.
      const error = (await response.json().catch(() => ({}))) as { error?: { type?: string; message?: string } };
      const reason = error.error ? `: ${error.error.type}: ${error.error.message?.slice(0, 300)}` : '';

      throw new AiRequestError(
        `Anthropic request failed (${response.status})${reason}`,
        AiProvider.Anthropic,
        response.status
      );
    }

    const body = (await response.json().catch(() => ({}))) as MessagesResponse;

    if (!body.content) {
      throw new AiRequestError('Anthropic response without content', AiProvider.Anthropic, response.status);
    }

    const text = body.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

    const toolCalls: ToolCall[] = body.content.flatMap((block) =>
      block.type === 'tool_use'
        ? [
            {
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
            }
          ]
        : []
    );

    const usage = body.usage ?? {};

    return {
      message: {
        role: 'assistant' as const,
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        blocks: body.content
      },
      usage: {
        // The whole prompt, like OpenRouter's `prompt_tokens`.
        inputTokens:
          (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens ?? 0,
        costUsd: anthropicCost(input.model, usage)
      },
      latencyMs: Date.now() - started
    };
  };
}
