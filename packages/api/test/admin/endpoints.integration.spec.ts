import type { Db } from '../../src/db';

import { equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { listStoresHandler } from '../../src/admin/endpoints/list-stores';
import { updateStoreHandler } from '../../src/admin/endpoints/update-store';
import { seedStore } from '../support/fixtures';

describe('admin endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const identity = { userId: 'user_admin' };

  it('lists stores with pending ones before active ones', async () => {
    // Pending created first: "newest first" alone would put it after the active one.
    const { storeId: pendingId } = await seedStore(db, { active: false });
    const { storeId: activeId } = await seedStore(db, { active: true });

    const { body } = await listStoresHandler({ identity } as never, { db });
    const ids = body.stores.map(({ id }) => id);

    ok(ids.indexOf(pendingId) >= 0);
    ok(ids.indexOf(pendingId) < ids.indexOf(activeId));

    const pending = body.stores.find(({ id }) => id === pendingId);

    equal(pending?.active, false);
    equal(pending?.acceptingOrders, true);
    ok(pending?.createdAt);
  });

  it('activates and deactivates a store', async () => {
    const { storeId } = await seedStore(db, { active: false });

    const update = (active: boolean) =>
      updateStoreHandler({ identity, parameters: { storeId }, body: { active } } as never, { db });

    equal((await update(true)).body.store.active, true);
    equal((await db.stores.findOne({ select: { active: true }, where: { id: storeId } }))?.active, true);

    equal((await update(false)).body.store.active, false);
  });

  it('returns 404 for an unknown store', async () => {
    await rejects(
      updateStoreHandler({ identity, parameters: { storeId: randomUUID() }, body: { active: true } } as never, { db }),
      HttpNotFoundError
    );
  });
});
