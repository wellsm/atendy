import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminClerkProvider } from '../provider';
import type { AdminIdentity } from '../types';
import type { AdminUser } from '../users';

import { ClerkBackend } from '../../clerk/backend';
import { BillingAccounts } from '../../payments/accounts';
import { orgIdsOfStores, storesByOrg, toAdminUser } from '../users';

export declare class UpdateAdminUserStoresRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    userId: string;
  };
  body: {
    storeIds: String.UUID[];
  };
}

export declare class UpdateAdminUserStoresResponse implements Http.Response {
  status: 200;
  body: {
    user: AdminUser;
  };
}

/**
 * Replaces the stores a login belongs to; memberships of orgs without a store are removed too.
 */
export async function updateAdminUserStoresHandler(
  request: Http.Incoming<UpdateAdminUserStoresRequest>,
  { db }: Service.Context<AdminClerkProvider>
): Promise<UpdateAdminUserStoresResponse> {
  const { userId } = request.parameters;
  const orgIds = await orgIdsOfStores(db, request.body.storeIds);

  const user = await ClerkBackend.getUser(userId);

  await ClerkBackend.setUserOrgs(userId, orgIds);

  // The first user given a store pays for it (one account for all their stores).
  for (const storeId of request.body.storeIds) {
    await BillingAccounts.assignOwner(db, storeId, userId);
  }

  return { status: 200, body: { user: toAdminUser(user, orgIds, await storesByOrg(db, orgIds)) } };
}
