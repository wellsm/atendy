import type { AiProvider } from './types';

/**
 * An AI provider call failed (HTTP error, timeout, invalid response or missing key). `status` 0 = no HTTP answer.
 * Messages never include keys, prompts or customer text.
 */
export class AiRequestError extends Error {
  constructor(
    message: string,
    public readonly provider: AiProvider,
    public readonly status: number
  ) {
    super(message);
  }
}

/**
 * A turn could not produce a reply. `retryable` is false once a tool changed the order or the conversation:
 * replaying the turn would repeat that change.
 */
export class TurnError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
  }
}
