import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { StaffError } from './errors';

/**
 * Runs a staff call; a `StaffError` becomes a 400 (input), 404 (another store's employee) or 409 (`manager_required`),
 * each with the field in the context.
 */
export const withStaffErrors = async <T>(write: () => T | Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof StaffError)) {
      throw error;
    }

    if (error.field === 'not_found') {
      throw new HttpNotFoundError(error.message);
    }

    if (error.field === 'manager_required' || error.field === 'settled') {
      throw new HttpConflictError(error.message, { field: error.field });
    }

    throw new HttpBadRequestError(error.message, { field: error.field });
  }
};
