export const enum CashErrorCode {
  SessionOpen = 'session_open',
  NoSession = 'no_session',
  AlreadyClosed = 'already_closed',
  Amount = 'amount',
  Reason = 'reason',
  /**
   * The session id is not one of the store's.
   */
  NotFound = 'not_found',
  /**
   * Malformed list cursor.
   */
  Before = 'before'
}

export class CashError extends Error {
  constructor(
    public readonly code: CashErrorCode,
    message: string
  ) {
    super(message);
  }
}
