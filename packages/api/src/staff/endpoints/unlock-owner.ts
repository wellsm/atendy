import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { HttpForbiddenError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { signOperator } from '../tokens';
import { StaffRole } from '../types';

/**
 * How recent the Clerk reverification (email code) must be.
 */
const MAX_FACTOR_AGE_MINUTES = 2;

export declare class UnlockOwnerRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class UnlockOwnerResponse implements Http.Response {
  status: 200;
  body: {
    operatorToken: string;
  };
}

/**
 * "Esqueci o PIN": the signed-in Clerk user, freshly reverified, becomes a manager operator for this session.
 */
export async function unlockOwnerHandler(
  request: Http.Incoming<UnlockOwnerRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UnlockOwnerResponse> {
  const store = await requireStore(db, request.identity);
  const age = request.identity.factorAgeMinutes;

  if (age === undefined || age > MAX_FACTOR_AGE_MINUTES) {
    throw new HttpForbiddenError('Verify your account again', { field: 'reverify' });
  }

  const operatorToken = signOperator({
    storeId: store.id,
    staffId: null,
    userId: request.identity.userId,
    role: StaffRole.Manager,
    version: 0
  });

  return { status: 200, body: { operatorToken } };
}
