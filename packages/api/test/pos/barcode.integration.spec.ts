import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { MenuRepository } from '../../src/menu/repository';
import { PriceMode } from '../../src/menu/types';
import { findPosBarcodeHandler } from '../../src/pos/endpoints/find-barcode';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { seedStore } from '../support/fixtures';

describe('pos barcode lookup', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const category = await MenuRepository.createCategory(db, storeId, 'Bebidas');
    const draft = { categoryId: category.id, description: null, priceCents: 500, groups: [] };

    const lookup = async (code: string) =>
      (await findPosBarcodeHandler({ identity: { userId: 'user_1', orgId }, parameters: { code } } as never, { db }))
        .body.candidates;

    const item = await StockRepository.createItem(
      db,
      storeId,
      { name: 'Heineken lata', unit: StockUnit.Unit, barcode: '7891234567895', minQty: null },
      [{ name: 'Fardo 12', factor: 12, barcode: '17891234567892' }]
    );

    return { storeId, draft, lookup, item };
  };

  const beerGroup = {
    name: 'Marca',
    min: 1,
    max: 1,
    priceMode: PriceMode.Sum,
    options: [{ name: 'Heineken', priceDeltaCents: 0, active: true }]
  };

  it('resolves an item code to a product and a package code to the option', async () => {
    const { storeId, draft, lookup, item } = await setup();

    const { product: lata } = await MenuRepository.createProduct(db, storeId, { ...draft, name: 'Heineken Lata' });
    const { product: fardo } = await MenuRepository.createProduct(db, storeId, {
      ...draft,
      name: 'Fardo 12 Latas',
      groups: [beerGroup]
    });
    const group = fardo.groups[0]!;
    const option = group.options[0]!;

    await StockRepository.setLinks(db, storeId, { productId: lata.id }, [{ stockItemId: item.id, qty: 1 }]);
    await StockRepository.setLinks(db, storeId, { optionId: option.id }, [{ stockItemId: item.id, qty: 12 }]);

    deepEqual(await lookup('7891234567895'), [{ productId: lata.id, productName: 'Heineken Lata', selection: null }]);
    deepEqual(await lookup('17891234567892'), [
      {
        productId: fardo.id,
        productName: 'Fardo 12 Latas',
        selection: { groupId: group.id, optionId: option.id, optionName: 'Heineken' }
      }
    ]);
  });

  it('returns one candidate per active product sharing the option', async () => {
    const { storeId, draft, lookup, item } = await setup();

    const { product: a } = await MenuRepository.createProduct(db, storeId, {
      ...draft,
      name: 'Combo A',
      groups: [beerGroup]
    });
    const shared = a.groups[0]!;

    await MenuRepository.createProduct(db, storeId, { ...draft, name: 'Combo B', groups: [shared] });
    await MenuRepository.createProduct(db, storeId, { ...draft, name: 'Combo C', active: false, groups: [shared] });
    await StockRepository.setLinks(db, storeId, { optionId: shared.options[0]!.id }, [
      { stockItemId: item.id, qty: 1 }
    ]);

    const names = (await lookup('7891234567895')).map((candidate) => candidate.productName).sort();

    deepEqual(names, ['Combo A', 'Combo B']);
  });

  it('returns nothing for an unknown code and rejects malformed ones', async () => {
    const { lookup } = await setup();

    deepEqual(await lookup('99999999'), []);
    await rejects(lookup('abc'), HttpBadRequestError);
    equal((await lookup('12345678901234567890')).length, 0);
  });
});
