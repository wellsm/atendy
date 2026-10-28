import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { PosError, PosErrorCode } from './errors';
import { PricingError } from '../orders/pricing';
import { OrderError } from '../orders/repository';

/**
 * Runs a POS call: `not_found` → 404, `not_draft` → 409, any other POS, order or pricing error → 400, each with the
 * code as `field`.
 */
export const withPosErrors = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof PosError && error.code === PosErrorCode.NotFound) {
      throw new HttpNotFoundError(error.message);
    }

    if (error instanceof PosError && error.code === PosErrorCode.NotDraft) {
      throw new HttpConflictError(error.message, { field: error.code });
    }

    if (error instanceof PosError || error instanceof OrderError || error instanceof PricingError) {
      throw new HttpBadRequestError(error.message, { field: error.code });
    }

    throw error;
  }
};
