import { AiRequestError } from './errors';
import { AiProvider } from './types';

// OpenRouter Decisions API (alpha). Note: no `/v1` in this path.
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';

const REQUEST_TIMEOUT_MS = 10_000;

export const JEV_MODEL = '~typesafe/jev-latest';

export type JevQuestion =
  | { type: 'choice'; instructions: unknown; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: unknown };

export type JevAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number };

type EvaluateResponse = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
};

export namespace JevClient {
  /**
   * One Jev request through OpenRouter: all questions run in parallel over the same state.
   */
  export const evaluate = async (input: { apiKey: string; state: unknown; questions: Record<string, JevQuestion> }) => {
    const started = Date.now();

    let response: Response;

    try {
      response = await fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL, state: input.state, questions: input.questions }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';

      throw new AiRequestError(`Jev request did not complete (${reason})`, AiProvider.Jev, 0);
    }

    if (!response.ok) {
      throw new AiRequestError(`Jev request failed (${response.status})`, AiProvider.Jev, response.status);
    }

    const body = (await response.json().catch(() => ({}))) as EvaluateResponse;

    if (!body.answers) {
      throw new AiRequestError('Jev response without answers', AiProvider.Jev, response.status);
    }

    return {
      model: body.model ?? JEV_MODEL,
      answers: body.answers,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        costUsd: body.usage?.cost ?? 0
      },
      latencyMs: Date.now() - started
    };
  };
}
