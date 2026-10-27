import type { Db } from '../../src/db';

import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { displayOrderCode, nextOrderCode } from '../../src/orders/code';
import { StoreRepository } from '../../src/stores/repository';
import { OrderCodeMode } from '../../src/stores/types';
import { seedStore } from '../support/fixtures';

describe('order codes', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('gives 6 upper case symbols without look-alikes by default', async () => {
    const { storeId } = await seedStore(db);
    const codes = await Promise.all(Array.from({ length: 20 }, () => nextOrderCode(db, storeId)));

    ok(codes.every((code) => /^[2-9A-HJKMNP-Z]{6}$/.test(code)));
  });

  it('counts from 1 per store in sequential mode, also with parallel placements', async () => {
    const first = await seedStore(db);
    const second = await seedStore(db);

    await StoreRepository.setOrderCodeMode(db, first.storeId, OrderCodeMode.Sequential);
    await StoreRepository.setOrderCodeMode(db, second.storeId, OrderCodeMode.Sequential);

    const codes = await Promise.all(Array.from({ length: 5 }, () => nextOrderCode(db, first.storeId)));

    equal([...codes].sort().join(','), '1,2,3,4,5');
    equal(await nextOrderCode(db, second.storeId), '1');
  });

  it('shows old orders by the start of their id, upper case', () => {
    equal(displayOrderCode({ id: 'abcd1234-0000', code: null }), 'ABCD');
    equal(displayOrderCode({ id: 'abcd1234-0000', code: '42' }), '42');
  });
});
