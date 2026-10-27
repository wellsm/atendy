import type { RealtimeDb } from '../../src/realtime-db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { ConnectionRepository } from '../../src/realtime/repository';
import { CONNECTION_TTL_SECONDS } from '../../src/realtime/types';

describe('connection repository', () => {
  const db = DatabaseTester.getClient<RealtimeDb>('RealtimeDb');

  const now = new Date('2026-01-01T12:00:00.000Z');

  it('register then listByStore returns the id; remove drops it', async () => {
    await ConnectionRepository.register(db, { connectionId: 'c-1', storeId: 'store-a', userId: 'u-1', now });

    deepEqual(await ConnectionRepository.listByStore(db, 'store-a'), ['c-1']);

    await ConnectionRepository.remove(db, 'c-1');

    deepEqual(await ConnectionRepository.listByStore(db, 'store-a'), []);
  });

  it("another store's id never appears", async () => {
    await ConnectionRepository.register(db, { connectionId: 'c-2', storeId: 'store-a', userId: 'u-1', now });
    await ConnectionRepository.register(db, { connectionId: 'c-3', storeId: 'store-b', userId: 'u-2', now });

    deepEqual(await ConnectionRepository.listByStore(db, 'store-a'), ['c-2']);
    deepEqual(await ConnectionRepository.listByStore(db, 'store-b'), ['c-3']);

    await ConnectionRepository.remove(db, 'c-2');
    await ConnectionRepository.remove(db, 'c-3');
  });

  it('expire_at is now plus 8100 seconds', async () => {
    await ConnectionRepository.register(db, { connectionId: 'c-4', storeId: 'store-c', userId: 'u-1', now });

    const row = await db.connections.findOne({ select: { expire_at: true }, where: { connection_id: 'c-4' } });

    equal(row?.expire_at, Math.floor(now.getTime() / 1000) + CONNECTION_TTL_SECONDS);

    await ConnectionRepository.remove(db, 'c-4');
  });
});
