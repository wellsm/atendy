import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { MenuRepository } from '../../src/menu/repository';
import { StockRepository } from '../../src/stock/repository';
import { StockFilter, StockUnit } from '../../src/stock/types';
import { StockError } from '../../src/stock/validation';
import { optionIdOf, productByName, seedMenu, seedStore } from '../support/fixtures';

const failsOn = (field: string) => (error: unknown) => error instanceof StockError && error.field === field;

const input = (name: string, overrides: { barcode?: string | null; minQty?: number | null } = {}) => ({
  name,
  unit: StockUnit.Unit,
  barcode: null,
  minQty: null,
  ...overrides
});

describe('StockRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setBalance = (id: string, balance: number) => db.stock_items.updateOne({ data: { balance }, where: { id } });

  it('creates an item and finds it by barcode', async () => {
    const { storeId } = await seedStore(db);
    const created = await StockRepository.createItem(db, storeId, input('Coca', { barcode: '7894900011517' }));

    equal(created.balance, 0);

    const found = await StockRepository.findByBarcode(db, storeId, '7894900011517');

    equal(found?.item.id, created.id);
    equal(found?.package, undefined);
  });

  it('refuses a barcode used by a package of another item, but allows it in another store', async () => {
    const { storeId } = await seedStore(db);
    const { storeId: otherStoreId } = await seedStore(db);
    const first = await StockRepository.createItem(db, storeId, input('Coca'));

    await StockRepository.replacePackages(db, storeId, first.id, [
      { name: 'Caixa', factor: 12, barcode: '7894900011517' }
    ]);

    await rejects(
      StockRepository.createItem(db, storeId, input('Guaraná', { barcode: '7894900011517' })),
      failsOn('barcode')
    );

    await StockRepository.createItem(db, otherStoreId, input('Guaraná', { barcode: '7894900011517' }));
  });

  it('refuses a package barcode equal to its own item or to another item', async () => {
    const { storeId } = await seedStore(db);
    const own = await StockRepository.createItem(db, storeId, input('Coca', { barcode: '7894900011517' }));
    const other = await StockRepository.createItem(db, storeId, input('Guaraná', { barcode: '7894900011524' }));

    await rejects(
      StockRepository.replacePackages(db, storeId, own.id, [{ name: 'Caixa', factor: 12, barcode: '7894900011517' }]),
      failsOn('barcode')
    );
    await rejects(
      StockRepository.replacePackages(db, storeId, own.id, [{ name: 'Caixa', factor: 12, barcode: '7894900011524' }]),
      failsOn('barcode')
    );

    equal(other.barcode, '7894900011524');
  });

  it('finds a package by its barcode', async () => {
    const { storeId } = await seedStore(db);
    const created = await StockRepository.createItem(db, storeId, input('Coca'));
    const [pack] = await StockRepository.replacePackages(db, storeId, created.id, [
      { name: 'Caixa', factor: 12, barcode: '7894900011517' }
    ]);

    const found = await StockRepository.findByBarcode(db, storeId, '7894900011517');

    equal(found?.item.id, created.id);
    equal(found?.package?.id, pack!.id);
    equal(found?.package?.factor, 12);
  });

  it('updates an item without clashing with itself', async () => {
    const { storeId } = await seedStore(db);
    const created = await StockRepository.createItem(db, storeId, input('Coca', { barcode: '7894900011517' }));

    const updated = await StockRepository.updateItem(
      db,
      storeId,
      created.id,
      input('Coca 2L', { barcode: '7894900011517' })
    );

    equal(updated?.name, 'Coca 2L');
    equal(await StockRepository.updateItem(db, storeId, randomUUID(), input('X')), undefined);
  });

  it('changes the unit only while the item has no movement and no link', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const grams = (name: string) => ({ ...input(name), unit: StockUnit.Gram });

    const fresh = await StockRepository.createItem(db, storeId, input('Farinha'));

    equal((await StockRepository.updateItem(db, storeId, fresh.id, grams('Farinha')))?.unit, StockUnit.Gram);

    const moved = await StockRepository.createItem(db, storeId, input('Queijo'));

    await StockRepository.recordEntry(db, storeId, { itemId: moved.id, qty: 5, author: 'test' });
    await rejects(StockRepository.updateItem(db, storeId, moved.id, grams('Queijo')), failsOn('unit'));
    equal((await StockRepository.updateItem(db, storeId, moved.id, input('Queijo 2')))?.name, 'Queijo 2');

    const linked = await StockRepository.createItem(db, storeId, input('Molho'));

    await StockRepository.setLinks(db, storeId, { productId: productByName(menu, 'Pizza Broto').id }, [
      { stockItemId: linked.id, qty: 1 }
    ]);
    await rejects(StockRepository.updateItem(db, storeId, linked.id, grams('Molho')), failsOn('unit'));
  });

  it('lists low, sold out, archived and all', async () => {
    const { storeId } = await seedStore(db);
    const low = await StockRepository.createItem(db, storeId, input('Low', { minQty: 2 }));
    const ok3 = await StockRepository.createItem(db, storeId, input('Ok', { minQty: 2 }));
    const noMin = await StockRepository.createItem(db, storeId, input('NoMin'));
    const gone = await StockRepository.createItem(db, storeId, input('Gone'));

    await setBalance(low.id, 2);
    await setBalance(ok3.id, 3);
    await setBalance(noMin.id, 1);

    const names = async (filter: StockFilter) =>
      (await StockRepository.listItems(db, storeId, filter)).map(({ name }) => name).sort();

    deepEqual(await names(StockFilter.Low), ['Low']);
    deepEqual(await names(StockFilter.SoldOut), ['Gone']);

    ok(await StockRepository.archiveItem(db, storeId, gone.id));

    deepEqual(await names(StockFilter.Archived), ['Gone']);
    deepEqual(await names(StockFilter.All), ['Low', 'NoMin', 'Ok']);
  });
  describe('links', () => {
    it('refuses an item or a target of another store', async () => {
      const { storeId } = await seedStore(db);
      const { storeId: otherStoreId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const otherMenu = await seedMenu(db, otherStoreId);
      const item = await StockRepository.createItem(db, storeId, input('Coca'));
      const otherItem = await StockRepository.createItem(db, otherStoreId, input('Outra'));
      const coca = productByName(menu, 'Coca-Cola 2L');

      await rejects(
        StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: otherItem.id, qty: 1 }]),
        failsOn('links')
      );

      await rejects(
        StockRepository.setLinks(db, storeId, { productId: productByName(otherMenu, 'Coca-Cola 2L').id }, [
          { stockItemId: item.id, qty: 1 }
        ]),
        failsOn('links')
      );

      const otherOption = optionIdOf(productByName(otherMenu, 'Pizza Broto'), 'Sabor', 'Calabresa');

      await rejects(
        StockRepository.setLinks(db, storeId, { optionId: otherOption }, [{ stockItemId: item.id, qty: 1 }]),
        failsOn('links')
      );
    });

    it('refuses archived items and more than 10 links', async () => {
      const { storeId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const coca = productByName(menu, 'Coca-Cola 2L');
      const archived = await StockRepository.createItem(db, storeId, input('Velho'));

      await StockRepository.archiveItem(db, storeId, archived.id);

      await rejects(
        StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: archived.id, qty: 1 }]),
        failsOn('links')
      );

      const items = [];

      for (let index = 0; index < 11; index++) {
        items.push(await StockRepository.createItem(db, storeId, input(`Item ${index}`)));
      }

      await rejects(
        StockRepository.setLinks(
          db,
          storeId,
          { productId: coca.id },
          items.map(({ id }) => ({ stockItemId: id, qty: 1 }))
        ),
        failsOn('links')
      );
    });

    it('replaces links and sums product and option usage', async () => {
      const { storeId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const coca = productByName(menu, 'Coca-Cola 2L');
      const broto = productByName(menu, 'Pizza Broto');
      const optionId = optionIdOf(broto, 'Sabor', 'Calabresa');
      const item = await StockRepository.createItem(db, storeId, input('Coca'));

      await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 3 }]);
      await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);
      await StockRepository.setLinks(db, storeId, { optionId }, [{ stockItemId: item.id, qty: 1 }]);

      deepEqual(await StockRepository.linksFor(db, storeId, { productId: coca.id }), [
        { stockItemId: item.id, name: 'Coca', unit: StockUnit.Unit, qty: 1 }
      ]);

      deepEqual(await StockRepository.usageFor(db, storeId, { productId: coca.id, optionIds: [optionId] }), [
        { stock_item_id: item.id, qty: 2 }
      ]);
    });

    it('reports sold out products and options from balances', async () => {
      const { storeId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const coca = productByName(menu, 'Coca-Cola 2L');
      const item = await StockRepository.createItem(db, storeId, input('Coca'));

      await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 2 }]);
      await setBalance(item.id, 1);

      deepEqual([...(await StockRepository.availability(db, storeId)).soldOutProducts], [coca.id]);

      await setBalance(item.id, 2);

      deepEqual([...(await StockRepository.availability(db, storeId)).soldOutProducts], []);
    });

    it('removes links when the item is archived', async () => {
      const { storeId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const coca = productByName(menu, 'Coca-Cola 2L');
      const item = await StockRepository.createItem(db, storeId, input('Coca'));

      await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);
      await StockRepository.archiveItem(db, storeId, item.id);

      deepEqual(await StockRepository.linksFor(db, storeId, { productId: coca.id }), []);
    });

    it('removes links when the product, an option or a group is deleted', async () => {
      const { storeId } = await seedStore(db);
      const menu = await seedMenu(db, storeId);
      const coca = productByName(menu, 'Coca-Cola 2L');
      const broto = productByName(menu, 'Pizza Broto');
      const optionId = optionIdOf(broto, 'Sabor', 'Calabresa');
      const item = await StockRepository.createItem(db, storeId, input('Coca'));
      const count = async () =>
        (await db.stock_links.findMany({ select: { id: true }, where: { store_id: storeId } })).records.length;

      await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);
      await StockRepository.setLinks(db, storeId, { optionId }, [{ stockItemId: item.id, qty: 1 }]);
      equal(await count(), 2);

      await MenuRepository.deleteProduct(db, storeId, coca.id);
      equal(await count(), 1);

      const groupId = broto.groups.find(({ name }) => name === 'Sabor')?.id ?? '';

      await MenuRepository.deleteGroup(db, storeId, groupId);
      equal(await count(), 0);
    });
  });
});
