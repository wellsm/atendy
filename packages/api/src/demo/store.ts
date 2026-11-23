import type { DbClient } from '../db';
import type { PanelIdentity } from '../panel/types';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { assertDemoEnabled } from './enabled';
import { isDemoPhone } from './phone';
import { ClerkBackend } from '../clerk/backend';
import { isSimulatedJid } from '../simulations/repository';

/**
 * The store behind `slug` when the login is a member of its org. The token carries only the active org, and the demo
 * phones talk to several stores at once, so membership comes from Clerk. Refuses what the webhook drops (inactive or
 * blocked stores), a phone outside the fake range and a phone that belongs to a real customer of the store.
 */
export const requireDemoStore = async (db: DbClient, identity: PanelIdentity, slug: string, phone: string) => {
  assertDemoEnabled();

  if (!isDemoPhone(phone)) {
    throw new HttpBadRequestError('Not a demo phone.', { field: 'phone' });
  }

  const store = await db.stores.findOne({
    select: { id: true, active: true, billing_blocked: true, clerk_org_id: true, policy: true },
    where: { slug }
  });

  if (!store?.clerk_org_id || !(await ClerkBackend.userOrgIds(identity.userId)).includes(store.clerk_org_id)) {
    throw new HttpNotFoundError('Store not found');
  }

  if (!store.active || store.billing_blocked) {
    throw new HttpConflictError('Store is not active.');
  }

  const customer = await db.customers.findOne({
    select: { whatsapp_jid: true },
    where: { store_id: store.id, phone }
  });

  if (customer && !isSimulatedJid(customer.whatsapp_jid)) {
    throw new HttpConflictError('This phone belongs to a real customer of the store.', { field: 'phone' });
  }

  return store;
};
