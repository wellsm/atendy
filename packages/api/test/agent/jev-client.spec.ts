import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { AiRequestError } from '../../src/agent/errors';
import { JevClient } from '../../src/agent/jev-client';

describe('JevClient.evaluate', () => {
  afterEach(() => mock.restoreAll());

  const questions = {
    wants_human: { type: 'noul' as const, instructions: 'Does the customer ask for a person?' }
  };

  it('posts state and questions to the OpenRouter Decisions API and returns answers and usage', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'typesafe/jev-1.13-20260917',
            answers: { wants_human: { type: 'noul', noul: 0.93 } },
            usage: { input_tokens: 300, output_tokens: 20, cost: 0.0000126 }
          }),
          { status: 200 }
        )
      )
    );

    const result = await JevClient.evaluate({ apiKey: 't', state: { new_messages: ['atendente'] }, questions });

    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];

    equal(url, 'https://openrouter.ai/api/alpha/decisions');
    equal((init.headers as Record<string, string>).Authorization, 'Bearer t');
    deepEqual(JSON.parse(init.body as string), {
      model: '~typesafe/jev-latest',
      state: { new_messages: ['atendente'] },
      questions
    });

    equal(result.model, 'typesafe/jev-1.13-20260917');
    deepEqual(result.answers.wants_human, { type: 'noul', noul: 0.93 });
    deepEqual(result.usage, { inputTokens: 300, outputTokens: 20, costUsd: 0.0000126 });
  });

  it('throws AiRequestError when OpenRouter has no credits', async () => {
    mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response('{"error":{"code":402,"message":"Insufficient credits"}}', { status: 402 }))
    );

    await rejects(
      JevClient.evaluate({ apiKey: 't', state: 'x', questions }),
      (error) => error instanceof AiRequestError && error.status === 402
    );
  });

  it('records zero cost when the response has no usage.cost', async () => {
    mock.method(globalThis, 'fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ model: 'm', answers: {}, usage: { input_tokens: 10, output_tokens: 1 } }), {
          status: 200
        })
      )
    );

    const result = await JevClient.evaluate({ apiKey: 't', state: 'x', questions });

    equal(result.usage.costUsd, 0);
  });
});
