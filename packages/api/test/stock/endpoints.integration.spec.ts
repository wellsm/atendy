import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { archiveStockItemHandler } from '../../src/stock/endpoints/archive-item';
import { createStockCountsHandler } from '../../src/stock/endpoints/create-counts';
import { createStockEntryHandler } from '../../src/stock/endpoints/create-entry';
import { createStockItemHandler } from '../../src/stock/endpoints/create-item';
import { createStockLossHandler } from '../../src/stock/endpoints/create-loss';
import { findStockBarcodeHandler } from '../../src/stock/endpoints/find-barcode';
import { getStockItemHandler } from '../../src/stock/endpoints/get-item';
import { getProductStockLinksHandler } from '../../src/stock/endpoints/get-product-links';
import { getStockSummaryHandler } from '../../src/stock/endpoints/get-summary';
import { listStockItemsHandler } from '../../src/stock/endpoints/list-items';
import { listStockMovementsHandler } from '../../src/stock/endpoints/list-movements';
import { setOptionStockLinksHandler } from '../../src/stock/endpoints/set-option-links';
import { setProductStockLinksHandler } from '../../src/stock/endpoints/set-product-links';
import { updateStockItemHandler } from '../../src/stock/endpoints/update-item';
import { LossReason, StockFilter, StockUnit } from '../../src/stock/types';
import { optionIdOf, productByName, seedMenu, seedStore } from '../support/fixtures';

describe('panel stock endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, identity: { userId: 'user_1', orgId } };
  };

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  const create = async (identity: { userId: string; orgId: string }, name: string, extra = {}) => {
    const { body } = await createStockItemHandler(
      { identity, body: { name, unit: StockUnit.Unit, barcode: null, minQty: null, packages: [], ...extra } } as never,
      { db }
    );

    return body.item;
  };

  it('creates, receives stock, and moves the summary', async () => {
    const { identity } = await setup();
    const item = await create(identity, 'Coca 2L', { minQty: 5, barcode: '7894900011517' });

    equal(item.balance, 0);
    deepEqual((await getStockSummaryHandler({ identity } as never, { db })).body, { low: 1, soldOut: 1 });

    await createStockEntryHandler({ identity, body: { itemId: item.id, qty: 3 } } as never, { db });

    deepEqual((await getStockSummaryHandler({ identity } as never, { db })).body, { low: 1, soldOut: 0 });

    await createStockEntryHandler({ identity, body: { itemId: item.id, qty: 10 } } as never, { db });

    deepEqual((await getStockSummaryHandler({ identity } as never, { db })).body, { low: 0, soldOut: 0 });

    const detail = await getStockItemHandler({ identity, parameters: { itemId: item.id } } as never, { db });

    equal(detail.body.item.balance, 13);
    equal(detail.body.movements.length, 2);
    equal(detail.body.movements[0]!.author, 'user_1');
    equal(detail.body.next, null);

    const listed = await listStockItemsHandler({ identity, query: { filter: StockFilter.Low } } as never, { db });

    deepEqual(listed.body.items, []);
  });

  it('saves packages with the item and receives by package', async () => {
    const { identity } = await setup();
    const item = await create(identity, 'Cerveja', {
      packages: [{ name: 'Caixa', factor: 12, barcode: '7891234567895' }]
    });

    const detail = await getStockItemHandler({ identity, parameters: { itemId: item.id } } as never, { db });

    equal(detail.body.packages.length, 1);

    const packageId = detail.body.packages[0]!.id;

    await createStockEntryHandler({ identity, body: { itemId: item.id, packageId, qty: 2 } } as never, { db });

    const found = await findStockBarcodeHandler({ identity, parameters: { code: '7891234567895' } } as never, { db });

    equal(found.body.item.balance, 24);
    equal(found.body.package?.id, packageId);

    const updated = await updateStockItemHandler(
      {
        identity,
        parameters: { itemId: item.id },
        body: { name: 'Cerveja Lata', unit: StockUnit.Unit, barcode: null, minQty: null, packages: [] }
      } as never,
      { db }
    );

    equal(updated.body.item.name, 'Cerveja Lata');
    deepEqual(updated.body.packages, []);
  });

  it('records losses, counts, history pages and archives', async () => {
    const { identity } = await setup();
    const item = await create(identity, 'Queijo');

    await createStockEntryHandler({ identity, body: { itemId: item.id, qty: 10 } } as never, { db });
    await createStockLossHandler({ identity, body: { itemId: item.id, qty: 2, reason: LossReason.Expired } } as never, {
      db
    });
    await createStockCountsHandler({ identity, body: { counts: [{ itemId: item.id, counted: 5 }] } } as never, { db });

    const page = await listStockMovementsHandler({ identity, parameters: { itemId: item.id }, query: {} } as never, {
      db
    });

    equal(page.body.movements.length, 3);
    equal(page.body.movements[0]!.balanceAfter, 5);

    await rejects(
      createStockLossHandler({ identity, body: { itemId: item.id, qty: 1, reason: LossReason.Other } } as never, {
        db
      }),
      badField('note')
    );

    await archiveStockItemHandler({ identity, parameters: { itemId: item.id } } as never, { db });

    const archived = await listStockItemsHandler({ identity, query: { filter: StockFilter.Archived } } as never, {
      db
    });

    equal(archived.body.items.length, 1);
  });

  it('keeps stores apart and validates input', async () => {
    const a = await setup();
    const b = await setup();
    const item = await create(a.identity, 'Farinha');

    for (const call of [
      () => getStockItemHandler({ identity: b.identity, parameters: { itemId: item.id } } as never, { db }),
      () => archiveStockItemHandler({ identity: b.identity, parameters: { itemId: item.id } } as never, { db }),
      () => findStockBarcodeHandler({ identity: b.identity, parameters: { code: '7894900011517' } } as never, { db }),
      () =>
        listStockMovementsHandler({ identity: b.identity, parameters: { itemId: item.id }, query: {} } as never, {
          db
        }),
      () =>
        updateStockItemHandler(
          {
            identity: b.identity,
            parameters: { itemId: item.id },
            body: { name: 'x', unit: StockUnit.Unit, barcode: null, minQty: null, packages: [] }
          } as never,
          { db }
        )
    ]) {
      await rejects(call(), (error) => error instanceof HttpNotFoundError);
    }

    await rejects(
      createStockItemHandler(
        {
          identity: a.identity,
          body: { name: 'Y', unit: StockUnit.Unit, barcode: '123', minQty: null, packages: [] }
        } as never,
        { db }
      ),
      badField('barcode')
    );
  });

  it('writes nothing when a package barcode clashes', async () => {
    const { identity } = await setup();
    const taken = await create(identity, 'Existente', { barcode: '7894900011517' });
    const clash = { name: 'Caixa', factor: 6, barcode: '7894900011517' };

    await rejects(create(identity, 'Novo', { packages: [clash] }), badField('barcode'));

    const listed = await listStockItemsHandler({ identity, query: {} } as never, { db });

    deepEqual(
      listed.body.items.map(({ name }) => name),
      ['Existente']
    );

    const item = await create(identity, 'Original', { packages: [{ name: 'Fardo', factor: 4, barcode: null }] });

    await rejects(
      updateStockItemHandler(
        {
          identity,
          parameters: { itemId: item.id },
          body: { name: 'Mudou', unit: StockUnit.Gram, barcode: null, minQty: 3, packages: [clash] }
        } as never,
        { db }
      ),
      badField('barcode')
    );

    const detail = await getStockItemHandler({ identity, parameters: { itemId: item.id } } as never, { db });

    equal(detail.body.item.name, 'Original');
    equal(detail.body.item.unit, StockUnit.Unit);
    equal(detail.body.item.minQty, null);
    deepEqual(
      detail.body.packages.map(({ name }) => name),
      ['Fardo']
    );
    ok(taken.id);
  });

  it('links products and options, and refuses another store', async () => {
    const a = await setup();
    const b = await setup();
    const menu = await seedMenu(db, a.storeId);
    const other = await seedMenu(db, b.storeId);
    const product = productByName(menu, 'Pizza Broto');
    const flavor = optionIdOf(productByName(menu, 'Pizza Grande'), 'Sabores', 'Calabresa');
    const item = await create(a.identity, 'Massa');

    const saved = await setProductStockLinksHandler(
      {
        identity: a.identity,
        parameters: { productId: product.id },
        body: { links: [{ stockItemId: item.id, qty: 2 }] }
      } as never,
      { db }
    );

    deepEqual(saved.body.links, [{ stockItemId: item.id, name: 'Massa', unit: StockUnit.Unit, qty: 2 }]);

    await setOptionStockLinksHandler(
      {
        identity: a.identity,
        parameters: { optionId: flavor },
        body: { links: [{ stockItemId: item.id, qty: 1 }] }
      } as never,
      { db }
    );

    const detail = await getStockItemHandler({ identity: a.identity, parameters: { itemId: item.id } } as never, {
      db
    });

    equal(detail.body.links.length, 2);
    ok(detail.body.links.some((link) => link.productId === product.id && link.name === product.name));
    ok(detail.body.links.some((link) => link.optionId === flavor));

    const read = await getProductStockLinksHandler(
      { identity: a.identity, parameters: { productId: productByName(menu, 'Pizza Grande').id } } as never,
      { db }
    );

    deepEqual(read.body.product, []);
    deepEqual(read.body.options.find(({ optionId }) => optionId === flavor)?.links, [
      { stockItemId: item.id, name: 'Massa', unit: StockUnit.Unit, qty: 1 }
    ]);

    const own = await getProductStockLinksHandler(
      { identity: a.identity, parameters: { productId: product.id } } as never,
      { db }
    );

    deepEqual(own.body.product, [{ stockItemId: item.id, name: 'Massa', unit: StockUnit.Unit, qty: 2 }]);

    await rejects(
      getProductStockLinksHandler(
        { identity: a.identity, parameters: { productId: productByName(other, 'Pizza Grande').id } } as never,
        { db }
      ),
      (error) => error instanceof HttpNotFoundError
    );

    const foreign = optionIdOf(productByName(other, 'Pizza Grande'), 'Sabores', 'Calabresa');

    await rejects(
      setOptionStockLinksHandler(
        {
          identity: a.identity,
          parameters: { optionId: foreign },
          body: { links: [{ stockItemId: item.id, qty: 1 }] }
        } as never,
        { db }
      ),
      badField('links')
    );
  });
});
