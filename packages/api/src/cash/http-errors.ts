import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { CashError, CashErrorCode } from './errors';

const CONFLICTS: CashErrorCode[] = [CashErrorCode.SessionOpen, CashErrorCode.NoSession, CashErrorCode.AlreadyClosed];

/**
 * Runs a cash call; a `CashError` becomes a 409 (drawer state), 404 (another store's session) or 400 (input), each with
 * the code as `field`.
 */
export const withCashErrors = async <T>(write: () => T | Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof CashError)) {
      throw error;
    }

    if (error.code === CashErrorCode.NotFound) {
      throw new HttpNotFoundError(error.message);
    }

    if (CONFLICTS.includes(error.code)) {
      throw new HttpConflictError(error.message, { field: error.code });
    }

    throw new HttpBadRequestError(error.message, { field: error.code });
  }
};
