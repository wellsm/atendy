import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelAuthProvider } from './provider';
import type { PanelIdentity } from './types';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { verifyClerkToken } from './clerk';

export declare class PanelAuthRequest implements Http.AuthRequest {
  headers: {
    authorization?: string;
  };
}

export declare class PanelAuthResponse implements Http.AuthResponse {
  identity: PanelIdentity;
}

/**
 * Any signed-in Clerk user. Handlers resolve the store from `orgId`.
 */
export async function panelAuthorizer(
  request: PanelAuthRequest,
  // Only links the provider: its variables are this Lambda's env (`verifyClerkToken` reads `process.env`).
  _context: Service.Context<PanelAuthProvider>
): Promise<PanelAuthResponse> {
  const identity = await verifyClerkToken(request.headers.authorization);

  if (!identity) {
    throw new HttpUnauthorizedError();
  }

  return { identity };
}
