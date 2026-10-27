import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { StoreRepository } from '../../stores/repository';

const MAX_ORG_IDS = 50;

export declare class ListPanelStoresRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    /**
     * Comma-separated Clerk org ids (the user's memberships).
     */
    orgIds: string;
  };
}

export declare class ListPanelStoresResponse implements Http.Response {
  status: 200;
  body: {
    stores: { orgId: string; slug: string; name: string }[];
  };
}

/**
 * Slug and name of the stores behind these orgs, so the panel can route by slug. Membership is not checked here
 * (no Clerk secret key): slug and name are public on the menu page, and switching still needs Clerk membership.
 */
export async function listPanelStoresHandler(
  request: Http.Incoming<ListPanelStoresRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListPanelStoresResponse> {
  const orgIds = [...new Set(request.query.orgIds.split(',').map((id) => id.trim()))]
    .filter(Boolean)
    .slice(0, MAX_ORG_IDS);

  if (!orgIds.length) {
    return { status: 200, body: { stores: [] } };
  }

  const records = await StoreRepository.listByOrgIds(db, orgIds);

  return {
    status: 200,
    body: {
      stores: records.flatMap(({ clerk_org_id, slug, name }) =>
        clerk_org_id ? [{ orgId: clerk_org_id, slug, name }] : []
      )
    }
  };
}
