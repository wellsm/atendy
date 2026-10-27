import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminAuthProvider } from './provider';
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
export async function adminAuthorizer(
  request: AdminAuthRequest,
  // Only links the provider: its variables are this Lambda's env (read from `process.env`).
  _context: Service.Context<AdminAuthProvider>
): Promise<AdminAuthResponse> {
  const identity = await verifyClerkToken(request.headers.authorization);

  if (!identity) {
    throw new HttpUnauthorizedError();
  }

  if (!adminUserIds().includes(identity.userId)) {
    throw new HttpForbiddenError();
  }

  return { identity: { userId: identity.userId } };
}
