import type { ChatMessage } from '../../src/agent/openrouter-client';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { AiRequestError } from '../../src/agent/errors';
import { OpenRouterClient } from '../../src/agent/openrouter-client';

describe('OpenRouterClient.chat', () => {
  afterEach(() => mock.restoreAll());

  const respond = (status: number, body: unknown) => {
    return mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })));
  };

  const messages: ChatMessage[] = [{ role: 'user', content: 'oi' }];

  const tool = {
    type: 'function' as const,
    function: { name: 'get_cart', description: 'Cart', parameters: { type: 'object', properties: {} } }
  };

  it('sends tools with usage accounting and returns tool calls, tokens and cost', async () => {
    const fetchMock = respond(200, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_cart', arguments: '{}' } }]
          }
        }
      ],
      usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.00021 }
    });

    const result = await OpenRouterClient.chat({
      apiKey: 'k',
      model: 'anthropic/claude-haiku-5.5',
      messages,
      tools: [tool]
    });

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;

    equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    equal((init.headers as Record<string, string>).Authorization, 'Bearer k');
    equal(sent.model, 'anthropic/claude-haiku-5.5');
    deepEqual(sent.usage, { include: true });
    deepEqual(sent.tools, [tool]);

    deepEqual(result.usage, { inputTokens: 120, outputTokens: 8, costUsd: 0.00021 });
    equal(result.message.tool_calls?.[0]?.function.name, 'get_cart');
  });

  it('omits tools when none are given and returns the text', async () => {
    const fetchMock = respond(200, {
      choices: [{ message: { content: 'Olá!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 }
    });

    const result = await OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages });

    const [, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];

    equal('tools' in (JSON.parse(init.body as string) as object), false);
    equal('reasoning' in (JSON.parse(init.body as string) as object), false);
    equal(result.message.content, 'Olá!');
    equal(result.message.tool_calls, undefined);
    equal(result.usage.costUsd, 0);
  });

  it('sends tool_choice none when asked for a text answer', async () => {
    const fetchMock = respond(200, { choices: [{ message: { content: 'Ok' } }] });

    await OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages, tools: [tool], toolChoice: 'none' });

    const [, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];

    equal((JSON.parse(init.body as string) as { tool_choice?: string }).tool_choice, 'none');
  });

  it('sends the reasoning effort when given', async () => {
    const fetchMock = respond(200, { choices: [{ message: { content: 'Ok' } }] });

    await OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages, reasoningEffort: 'low' });

    const [, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];

    deepEqual((JSON.parse(init.body as string) as { reasoning?: unknown }).reasoning, { effort: 'low' });
  });

  it('throws AiRequestError with the HTTP status', async () => {
    respond(429, { error: { message: 'rate limited' } });

    await rejects(
      OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages }),
      (error) => error instanceof AiRequestError && error.status === 429
    );
  });

  it('throws AiRequestError with status 0 when the request does not complete', async () => {
    mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('fetch failed')));

    await rejects(
      OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages }),
      (error) => error instanceof AiRequestError && error.status === 0
    );
  });

  it('throws when the response has no message', async () => {
    respond(200, { choices: [] });

    await rejects(OpenRouterClient.chat({ apiKey: 'k', model: 'm', messages }), AiRequestError);
  });
});

describe('OpenRouterClient.transcribe', () => {
  afterEach(() => mock.restoreAll());

  const input = { apiKey: 'k', model: 'openai/whisper-large-v3-turbo', data: 'T2dn', format: 'ogg', language: 'pt' };

  it('posts the audio as base64 and returns the text, tokens and cost', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ text: ' uma calabresa ', usage: { seconds: 4, cost: 0.0000133 } }), {
          status: 200
        })
      )
    );

    const result = await OpenRouterClient.transcribe(input);

    equal(result.text, 'uma calabresa');
    deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, costUsd: 0.0000133 });

    const [url, init] = fetchMock.mock.calls[0]!.arguments as unknown as [string, RequestInit];

    equal(url, 'https://openrouter.ai/api/v1/audio/transcriptions');
    equal((init.headers as Record<string, string>).Authorization, 'Bearer k');
    deepEqual(JSON.parse(init.body as string), {
      model: 'openai/whisper-large-v3-turbo',
      input_audio: { data: 'T2dn', format: 'ogg' },
      language: 'pt'
    });
  });

  it('throws an AiRequestError on a failed response', async () => {
    mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', { status: 502 })));

    await rejects(OpenRouterClient.transcribe(input), AiRequestError);
  });
});
