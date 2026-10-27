import type { Object } from '@ez4/schema';

export const enum AiProvider {
  Anthropic = 'anthropic',
  Jev = 'jev',
  OpenRouter = 'openrouter'
}

export const enum AiPath {
  JevDirect = 'jev_direct',
  LlmFallback = 'llm_fallback',
  LlmReply = 'llm_reply',
  /**
   * A customer voice note turned into text before the turn.
   */
  Transcription = 'transcription'
}

/**
 * A tool an AI call asked for, as it ran. `args` as the model sent them (null when not an object).
 */
export type AiToolTrace = {
  name: string;
  args: Object.Any | null;
  ok: boolean;
  /**
   * Tool error code when `ok` is false.
   */
  error?: string;
};
