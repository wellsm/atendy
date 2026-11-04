import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelMeProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { isDemoEnabled } from '../../demo/enabled';
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
    /**
     * The demo phones (`DEMO_ENABLED`) are on.
     */
    demoEnabled: boolean;
  };
}

/**
 * Tells the panel where the user is: no org yet, org without store (onboarding), or the store.
 */
export async function getMeHandler(
  request: Http.Incoming<GetMeRequest>,
  { db }: Service.Context<PanelMeProvider>
): Promise<GetMeResponse> {
  const { orgId } = request.identity;
  const demoEnabled = isDemoEnabled();

  if (!orgId) {
    return { status: 200, body: { hasOrg: false, store: null, demoEnabled } };
  }

  const store = await StoreRepository.findByOrgId(db, orgId);

  return {
    status: 200,
    body: { hasOrg: true, store: store ? await loadPanelStore(db, store) : null, demoEnabled }
  };
}
