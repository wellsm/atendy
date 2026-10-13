import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { StoreRepository } from '../../stores/repository';
import { loadPanelStore } from '../store';

export declare class GetMeRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetMeResponse implements Http.Response {
  status: 200;
  body: {
    hasOrg: boolean;
    store: PanelStore | null;
  };
}

/**
 * Tells the panel where the user is: no org yet, org without store (onboarding), or the store.
 */
export async function getMeHandler(
  request: Http.Incoming<GetMeRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetMeResponse> {
  const { orgId } = request.identity;

  if (!orgId) {
    return { status: 200, body: { hasOrg: false, store: null } };
  }

  const store = await StoreRepository.findByOrgId(db, orgId);

  return { status: 200, body: { hasOrg: true, store: store ? await loadPanelStore(db, store) : null } };
}
