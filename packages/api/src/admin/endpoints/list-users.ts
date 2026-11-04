import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminClerkProvider } from '../provider';
import type { AdminIdentity } from '../types';
import type { AdminUser } from '../users';

import { ClerkBackend } from '../../clerk/backend';
import { storesByOrg, toAdminUser } from '../users';

export declare class ListAdminUsersRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class ListAdminUsersResponse implements Http.Response {
  status: 200;
  body: {
    users: AdminUser[];
  };
}

/**
 * Clerk users with the stores they belong to (one org = one store).
 */
export async function listAdminUsersHandler(
  _request: Http.Incoming<ListAdminUsersRequest>,
  { db }: Service.Context<AdminClerkProvider>
): Promise<ListAdminUsersResponse> {
  const users = await ClerkBackend.listUsers();
  const stores = await storesByOrg(db, [...new Set(users.flatMap(({ orgIds }) => orgIds))]);

  return {
    status: 200,
    body: { users: users.map(({ orgIds, ...user }) => toAdminUser(user, orgIds, stores)) }
  };
}
