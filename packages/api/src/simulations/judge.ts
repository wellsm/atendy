import type { TranscriptMessage } from './customer';
import type { SimulationCheck } from './types';

import { JevClient } from '../agent/jev-client';

/**
 * A judge question passes when Jev says "yes" with at least this probability.
 */
export const JUDGE_PASS_PROBABILITY = 0.8;

/**
 * Asks Jev each scenario `judge` question (yes = pass) about the whole transcript, in one request.
 */
export const judgeTranscript = async (input: {
  apiKey: string;
  questions: string[];
  transcript: TranscriptMessage[];
}): Promise<{ checks: SimulationCheck[]; costUsd: number }> => {
  if (!input.questions.length) {
    return { checks: [], costUsd: 0 };
  }

  const keys = input.questions.map((_, index) => `q${index}`);

  const { answers, usage } = await JevClient.evaluate({
    apiKey: input.apiKey,
    state: {
      conversation: input.transcript.map(({ fromCustomer, body }) => ({
        from: fromCustomer ? 'customer' : 'store',
        text: body
      }))
    },
    questions: Object.fromEntries(
      keys.map((key, index) => [
        key,
        {
          type: 'noul' as const,
          instructions: `About the WhatsApp \`conversation\` between a customer and a food store's assistant: ${input.questions[index]}`
        }
      ])
    )
  });

  const checks = input.questions.map((question, index) => {
    const answer = answers[keys[index]!];
    const probability = answer?.type === 'noul' ? answer.noul : 0;

    return {
      name: 'judge',
      pass: probability >= JUDGE_PASS_PROBABILITY,
      expected: question,
      actual: `sim ${Math.round(probability * 100)}%`
    };
  });

  return { checks, costUsd: usage.costUsd };
};
