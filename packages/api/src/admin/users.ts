import type { DbClient } from '../db';

import { HttpBadRequestError } from '@ez4/gateway';

export type AdminUserStore = {
  id: string;
  name: string;
  slug: string;
};

export type AdminUser = {
  id: string;
  email: string;
  stores: AdminUserStore[];
};

/**
 * Stores of these Clerk orgs (orgs without a store are left out), by org id.
 */
export const storesByOrg = async (db: DbClient, orgIds: string[]) => {
  if (!orgIds.length) {
    return new Map<string, AdminUserStore>();
  }

  const { records } = await db.stores.findMany({
    select: { id: true, name: true, slug: true, clerk_org_id: true },
    where: { clerk_org_id: { isIn: orgIds } }
  });

  return new Map(records.map(({ clerk_org_id, ...store }) => [clerk_org_id!, store]));
};

export const toAdminUser = (
  user: { id: string; email: string },
  orgIds: string[],
  stores: Map<string, AdminUserStore>
): AdminUser => ({
  ...user,
  stores: orgIds.map((orgId) => stores.get(orgId)).filter((store) => store !== undefined)
});

/**
 * Clerk org ids of the chosen stores; a store that does not exist or has no org is a 400 on `store_ids`.
 */
export const orgIdsOfStores = async (db: DbClient, storeIds: string[]) => {
  const unique = [...new Set(storeIds)];

  const { records } = unique.length
    ? await db.stores.findMany({ select: { clerk_org_id: true }, where: { id: { isIn: unique } } })
    : { records: [] };

  const orgIds = records.map(({ clerk_org_id }) => clerk_org_id).filter((orgId) => orgId != null);

  if (orgIds.length !== unique.length) {
    throw new HttpBadRequestError('Unknown store or store without a Clerk org.', { field: 'store_ids' });
  }

  return orgIds;
};
