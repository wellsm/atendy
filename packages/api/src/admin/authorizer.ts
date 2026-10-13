import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from './types';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';

import { verifyClerkToken } from '../panel/clerk';

export declare class AdminAuthRequest implements Http.AuthRequest {
  headers: {
    authorization?: string;
  };
}

export declare class AdminAuthResponse implements Http.AuthResponse {
  identity: AdminIdentity;
}

const adminUserIds = () =>
  (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

/**
 * Same Clerk login as the panel, restricted to the user ids in `ADMIN_USER_IDS` (comma-separated).
 */
export async function adminAuthorizer(request: AdminAuthRequest): Promise<AdminAuthResponse> {
  const identity = await verifyClerkToken(request.headers.authorization);

  if (!identity) {
    throw new HttpUnauthorizedError();
  }

  if (!adminUserIds().includes(identity.userId)) {
    throw new HttpForbiddenError();
  }

  return { identity: { userId: identity.userId } };
}
