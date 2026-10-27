import type { Service } from '@ez4/common';
import type { Ws } from '@ez4/gateway';
import type { PanelSocketAuthProvider } from './provider';
import type { PanelSocketIdentity } from './types';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';

import { verifyClerkToken } from '../panel/clerk';
import { StoreRepository } from '../stores/repository';

export declare class PanelSocketAuthRequest implements Ws.AuthRequest {
  query: {
    token: string;
    slug: string;
  };
}

export declare class PanelSocketAuthResponse implements Ws.AuthResponse {
  identity: PanelSocketIdentity;
}

/**
 * The store comes from the token org, like the panel's HTTP routes; `slug` must name that same store, so a tab left
 * on another store's panel after an org switch never listens to the new one.
 */
export async function panelSocketAuthorizer(
  request: PanelSocketAuthRequest,
  { db }: Service.Context<PanelSocketAuthProvider>
): Promise<PanelSocketAuthResponse> {
  const { token, slug } = request.query;

  const identity = await verifyClerkToken(`Bearer ${token}`);

  if (!identity) {
    throw new HttpUnauthorizedError();
  }

  const store = identity.orgId ? await StoreRepository.findByOrgId(db, identity.orgId) : undefined;

  if (!store || store.slug !== slug) {
    throw new HttpForbiddenError();
  }

  return { identity: { userId: identity.userId, storeId: store.id } };
}
