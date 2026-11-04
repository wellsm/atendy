import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminClerkProvider } from '../provider';
import type { AdminIdentity } from '../types';
import type { AdminUser } from '../users';

import { ClerkBackend } from '../../clerk/backend';
import { BillingAccounts } from '../../payments/accounts';
import { orgIdsOfStores, storesByOrg, toAdminUser } from '../users';

export declare class CreateAdminUserRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    /**
     * Ending in `+clerk_test` it signs in with the fixed code `424242` (Clerk test mode).
     */
    email: String.Email;
    storeIds: String.UUID[];
  };
}

export declare class CreateAdminUserResponse implements Http.Response {
  status: 201;
  body: {
    user: AdminUser;
  };
}

/**
 * A Clerk login (no password, email code) that is a member of the chosen stores.
 */
export async function createAdminUserHandler(
  request: Http.Incoming<CreateAdminUserRequest>,
  { db }: Service.Context<AdminClerkProvider>
): Promise<CreateAdminUserResponse> {
  const email = request.body.email.trim().toLowerCase();
  const orgIds = await orgIdsOfStores(db, request.body.storeIds);

  const userId = await ClerkBackend.createUser(email);

  await ClerkBackend.setUserOrgs(userId, orgIds);

  // The first user given a store pays for it (one account for all their stores).
  for (const storeId of request.body.storeIds) {
    await BillingAccounts.assignOwner(db, storeId, userId);
  }

  return {
    status: 201,
    body: { user: toAdminUser({ id: userId, email }, orgIds, await storesByOrg(db, orgIds)) }
  };
}
