import type { ChatMessage } from '../../src/agent/openrouter-client';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { AnthropicClient, anthropicCost, toAnthropicMessages } from '../../src/agent/anthropic-client';
import { AiRequestError } from '../../src/agent/errors';
import { AiProvider } from '../../src/agent/types';

describe('AnthropicClient', () => {
  afterEach(() => mock.restoreAll());

  const respond = (status: number, body: unknown) => {
    return mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })));
  };

  type SentBody = Record<string, unknown> & { messages: { content: { cache_control?: unknown }[] }[] };

  const tool = {
    type: 'function' as const,
    function: { name: 'get_cart', description: 'Cart', parameters: { type: 'object', properties: {} } }
  };

  const history: ChatMessage[] = [
    { role: 'system', content: 'Você atende.' },
    { role: 'user', content: '{"state":1}' },
    {
      role: 'assistant',
      content: 'Vou ver.',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'get_cart', arguments: '' } },
        { id: 'c2', type: 'function', function: { name: 'add_item', arguments: '{"qty":2}' } }
      ]
    },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 'c2', content: '{"ok":false}' }
  ];

  it('converts the OpenAI-shaped history: system apart, tool calls and results as blocks', () => {
    deepEqual(toAnthropicMessages(history), {
      system: 'Você atende.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '{"state":1}' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Vou ver.' },
            { type: 'tool_use', id: 'c1', name: 'get_cart', input: {} },
            { type: 'tool_use', id: 'c2', name: 'add_item', input: { qty: 2 } }
          ]
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' },
            { type: 'tool_result', tool_use_id: 'c2', content: '{"ok":false}' }
          ]
        }
      ]
    });
  });

  it('sends the raw blocks of an Anthropic answer back unchanged, thinking included', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const blocks = [thinking, { type: 'tool_use', id: 't1', name: 'get_cart', input: {} }];

    const fetchMock = respond(200, { content: [{ type: 'text', text: 'Pronto.' }], usage: {} });

    const messages: ChatMessage[] = [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: null, tool_calls: [], blocks },
      { role: 'assistant', content: 'ignored when blocks exist', blocks: [{ type: 'text', text: 'raw' }] },
      { role: 'tool', tool_call_id: 't1', content: '{}' }
    ];

    await AnthropicClient.chat({ apiKey: 'ak', model: 'claude-haiku-5-5', messages, tools: [tool] });

    const sent = JSON.parse((fetchMock.mock.calls[0]!.arguments[1] as RequestInit).body as string) as SentBody;

    deepEqual(sent.messages[1], {
      role: 'assistant',
      content: [thinking, { type: 'tool_use', id: 't1', name: 'get_cart', input: {} }, { type: 'text', text: 'raw' }]
    });

    // The cache breakpoint goes on the request copy, never on the history kept for the next round.
    deepEqual(blocks[0], { type: 'thinking', thinking: '', signature: 'sig' });
  });

  it('sends tools and cache breakpoints and returns tool calls, tokens and cost', async () => {
    const fetchMock = respond(200, {
      content: [
        { type: 'text', text: 'Certo.' },
        { type: 'tool_use', id: 'c3', name: 'get_cart', input: { full: true } }
      ],
      usage: { input_tokens: 200, cache_creation_input_tokens: 1000, cache_read_input_tokens: 3000, output_tokens: 40 }
    });

    const result = await AnthropicClient.chat({
      apiKey: 'ak',
      model: 'claude-haiku-5-5',
      messages: history,
      tools: [tool],
      toolChoice: 'none'
    });

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const sent = JSON.parse(init.body as string) as SentBody;

    equal(url, 'https://api.anthropic.com/v1/messages');
    equal(headers['x-api-key'], 'ak');
    equal(headers['anthropic-version'], '2023-06-01');
    equal(sent.model, 'claude-haiku-5-5');
    deepEqual(sent.system, [{ type: 'text', text: 'Você atende.', cache_control: { type: 'ephemeral' } }]);
    deepEqual(sent.tools, [{ name: 'get_cart', description: 'Cart', input_schema: tool.function.parameters }]);
    deepEqual(sent.tool_choice, { type: 'none' });
    deepEqual(sent.messages.at(-1)?.content.at(-1)?.cache_control, { type: 'ephemeral' });

    deepEqual(result.message, {
      role: 'assistant',
      content: 'Certo.',
      tool_calls: [{ id: 'c3', type: 'function', function: { name: 'get_cart', arguments: '{"full":true}' } }],
      blocks: [
        { type: 'text', text: 'Certo.' },
        { type: 'tool_use', id: 'c3', name: 'get_cart', input: { full: true } }
      ]
    });

    equal(result.usage.inputTokens, 4200);
    equal(result.usage.outputTokens, 40);
    // 200 × 0.10 + 1000 × 0.125 + 3000 × 0.01 + 40 × 0.50, per million.
    equal(result.usage.costUsd.toFixed(9), '0.000195000');
  });

  it('caches only the system prompt without tools and returns null content for no text', async () => {
    const fetchMock = respond(200, { content: [], usage: { input_tokens: 10, output_tokens: 0 } });

    const result = await AnthropicClient.chat({
      apiKey: 'ak',
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'oi' }
      ]
    });

    const sent = JSON.parse((fetchMock.mock.calls[0]!.arguments[1] as RequestInit).body as string) as SentBody;

    equal(sent.tools, undefined);
    equal(sent.tool_choice, undefined);
    deepEqual(sent.messages, [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }]);
    equal(result.message.content, null);
    equal(result.message.tool_calls, undefined);
  });

  it('prices long Haiku prompts at the higher rates and unknown models at zero', () => {
    equal(anthropicCost('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 }), 0.1);
    equal(anthropicCost('claude-unknown', { input_tokens: 1000, output_tokens: 1000 }), 0);
  });

  it('throws AiRequestError with the status on HTTP errors and 0 on network errors', async () => {
    respond(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Key not scoped to a workspace' } });

    await rejects(
      AnthropicClient.chat({ apiKey: 'ak', model: 'claude-haiku-5-5', messages: history }),
      (error) =>
        error instanceof AiRequestError &&
        error.status === 400 &&
        error.provider === AiProvider.Anthropic &&
        error.message === 'Anthropic request failed (400): invalid_request_error: Key not scoped to a workspace'
    );

    mock.restoreAll();
    mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('fetch failed')));

    await rejects(
      AnthropicClient.chat({ apiKey: 'ak', model: 'claude-haiku-5-5', messages: history }),
      (error) => error instanceof AiRequestError && error.status === 0
    );
  });
});
