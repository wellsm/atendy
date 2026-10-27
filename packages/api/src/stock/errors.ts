import { HttpBadRequestError } from '@ez4/gateway';

import { StockError } from './validation';

/**
 * Runs a stock write; a `StockError` becomes a 400 whose context names the field to fix.
 */
export const withStockErrors = async <T>(write: () => T | Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof StockError) {
      throw new HttpBadRequestError(error.message, { field: error.field });
    }

    throw error;
  }
};
