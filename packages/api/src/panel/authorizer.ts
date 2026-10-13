import type { Http } from '@ez4/gateway';
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
export async function panelAuthorizer(request: PanelAuthRequest): Promise<PanelAuthResponse> {
  const identity = await verifyClerkToken(request.headers.authorization);

  if (!identity) {
    throw new HttpUnauthorizedError();
  }

  return { identity };
}
