import type { Permission } from './permissions';
import type { DbClient } from '../db';
import type { PanelIdentity } from '../panel/types';

import { HttpForbiddenError } from '@ez4/gateway';

import { APPROVABLE, ROLE_PERMISSIONS } from './permissions';
import { StaffRepository } from './repository';
import { verifyApproval, verifyOperator } from './tokens';
import { StaffRole } from './types';

/**
 * Add as `headers: OperatorHeaders` to the request of every handler that calls `authorize`. Not on the authorizer:
 * Ez4 makes each authorizer header an API Gateway identity source, and a missing one answers 401.
 */
export type OperatorHeaders = {
  'x-operator'?: string;
  'x-approval'?: string;
};

const refuse = (field: 'operator_required' | 'approval_required' | 'forbidden') => {
  throw new HttpForbiddenError('Not allowed for this operator', { field });
};

/**
 * The author a panel write records, or a 403 whose `context.field` tells the web what to ask for. Unlocked stores
 * keep today's behavior (the Clerk user). The tokens are verified here (an invalid one counts as absent); role and
 * active flag come from the database, never from the token. Its handler's provider needs `PANEL_OPERATOR_SECRET`.
 */
export const authorize = async (
  db: DbClient,
  store: { id: string },
  identity: PanelIdentity,
  headers: OperatorHeaders | undefined,
  permission: Permission
): Promise<{ author: string }> => {
  if (!(await StaffRepository.isLocked(db, store.id))) {
    return { author: identity.userId };
  }

  const operator = verifyOperator(headers?.['x-operator']);

  if (!operator || operator.storeId !== store.id) {
    return refuse('operator_required');
  }

  // The owner after Clerk reverification acts as a manager, only for the same Clerk user.
  if (operator.staffId === null) {
    return operator.userId === identity.userId ? { author: identity.userId } : refuse('operator_required');
  }

  const member = await StaffRepository.findActive(db, store.id, operator.staffId);

  if (!member || member.pinVersion !== operator.version) {
    return refuse('operator_required');
  }

  if (ROLE_PERMISSIONS[member.role].includes(permission)) {
    return { author: member.id };
  }

  // Only the cashier may ask for a manager approval: the kitchen has none of the approvable actions.
  if (member.role !== StaffRole.Cashier || !APPROVABLE.includes(permission)) {
    return refuse('forbidden');
  }

  const approval = verifyApproval(headers?.['x-approval']);

  if (approval && approval.storeId === store.id && approval.permission === permission) {
    const manager = await StaffRepository.findActive(db, store.id, approval.staffId);

    if (manager?.role === StaffRole.Manager) {
      return { author: manager.id };
    }
  }

  return refuse('approval_required');
};
