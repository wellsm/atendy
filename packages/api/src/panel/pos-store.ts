import type { DbClient } from '../db';
import type { PanelIdentity } from './types';

import { HttpForbiddenError } from '@ez4/gateway';

import { requireStore } from './store';

/**
 * The token org's store for cash and POS writes: an inactive or billing-blocked store reads only.
 */
export const requirePosStore = async (db: DbClient, identity: PanelIdentity) => {
  const store = await requireStore(db, identity);

  const blocked = await db.stores.findOne({ select: { billing_blocked: true }, where: { id: store.id } });

  if (!store.active || blocked?.billing_blocked) {
    throw new HttpForbiddenError('The store is blocked', { field: 'store_blocked' });
  }

  return store;
};
