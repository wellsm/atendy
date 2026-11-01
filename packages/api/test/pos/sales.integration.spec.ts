import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { BucketTester } from '@ez4/local-storage/test';

import { MenuRepository } from '../../src/menu/repository';
import { OrderRepository } from '../../src/orders/repository';
import { OrderSource, OrderStatus } from '../../src/orders/types';
import { addPosSaleItemHandler } from '../../src/pos/endpoints/add-item';
import { createPosSaleHandler } from '../../src/pos/endpoints/create-sale';
import { discardPosSaleHandler } from '../../src/pos/endpoints/discard-sale';
import { getPosMenuHandler } from '../../src/pos/endpoints/get-menu';
import { getPosSaleHandler } from '../../src/pos/endpoints/get-sale';
import { listPosSalesHandler } from '../../src/pos/endpoints/list-sales';
import { removePosSaleItemHandler } from '../../src/pos/endpoints/remove-item';
import { updatePosSaleItemHandler } from '../../src/pos/endpoints/update-item';
import { updatePosSaleHandler } from '../../src/pos/endpoints/update-sale';
import { PosRepository } from '../../src/pos/repository';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('pos sales', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const productImages = BucketTester.getClientMock('ProductImages');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, menu, identity: { userId: 'user_1', orgId } };
  };

  type Identity = { userId: string; orgId: string };

  const create = async (identity: Identity, saleId: string = randomUUID(), label?: string) =>
    (await createPosSaleHandler({ identity, parameters: { saleId }, body: { label } } as never, { db })).body.sale;

  const add = async (identity: Identity, saleId: string, body: Record<string, unknown>) =>
    (await addPosSaleItemHandler({ identity, parameters: { saleId }, body } as never, { db })).body.sale;

  const patch = async (identity: Identity, saleId: string, body: Record<string, unknown>) =>
    (await updatePosSaleHandler({ identity, parameters: { saleId }, body } as never, { db })).body.sale;

  const withField = (type: Function, field: string) => (error: unknown) =>
    error instanceof type && (error as HttpBadRequestError).context?.field === field;

  it('creates a sale once for the same id', async () => {
    const { storeId, identity } = await setup();
    const saleId: string = randomUUID();

    const first = await create(identity, saleId, ' Maria ');
    const again = await create(identity, saleId);

    equal(first.id, saleId);
    equal(again.label, 'Maria');
    equal(first.createdBy, 'user_1');
    equal(first.canceledBy, null);

    const { records } = await db.orders.findMany({
      select: { source: true, status: true, conversation_id: true, customer_id: true, created_by: true },
      where: { store_id: storeId }
    });

    deepEqual(records, [
      {
        source: OrderSource.Pos,
        status: OrderStatus.Draft,
        conversation_id: null,
        customer_id: null,
        created_by: 'user_1'
      }
    ]);

    await rejects(create(identity, randomUUID(), 'x'.repeat(41)), withField(HttpBadRequestError, 'label'));
  });

  it('prices lines on the server with discounts', async () => {
    const { menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const { id } = await create(identity);

    const sale = await add(identity, id, {
      productId: coca.id,
      qty: 2,
      selections: [],
      discount: { kind: 'percent', value: 50 }
    });

    equal(sale.subtotalCents, coca.price_cents);
    deepEqual(sale.items[0]!.discount, { kind: 'percent', value: 50 });

    const discounted = await patch(identity, id, { discount: { kind: 'value', value: 100 }, surchargeCents: 250 });

    equal(discounted.discountCents, 100);
    equal(discounted.surchargeCents, 250);
    equal(discounted.totalCents, coca.price_cents - 100 + 250);

    await rejects(
      patch(identity, id, { discount: { kind: 'percent', value: 101 } }),
      withField(HttpBadRequestError, 'discount')
    );
    await rejects(
      patch(identity, id, { discount: { kind: 'value', value: 0 } }),
      withField(HttpBadRequestError, 'discount')
    );

    const itemId = sale.items[0]!.itemId;

    const updated = (
      await updatePosSaleItemHandler(
        { identity, parameters: { saleId: id, itemId }, body: { qty: 3, discount: null } } as never,
        { db }
      )
    ).body.sale;

    equal(updated.subtotalCents, coca.price_cents * 3);

    const removed = (await removePosSaleItemHandler({ identity, parameters: { saleId: id, itemId } } as never, { db }))
      .body.sale;

    equal(removed.items.length, 0);
    equal(removed.totalCents, 250);
  });

  it('sells a sold-out product at the counter', async () => {
    const { storeId, menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);

    const { id } = await create(identity);
    const sale = await add(identity, id, { productId: coca.id, qty: 1, selections: [] });

    equal(sale.items.length, 1);
    equal(sale.totalCents, coca.price_cents);
  });

  it('attaches the same customer the bot uses', async () => {
    const { storeId, identity } = await setup();
    const customerId = randomUUID();
    const now = new Date().toISOString();

    await db.customers.insertOne({
      data: {
        id: customerId,
        store_id: storeId,
        phone: '5511999998888',
        whatsapp_jid: '5511999998888@s.whatsapp.net',
        name: 'Maria',
        created_at: now,
        updated_at: now
      }
    });

    const { id } = await create(identity);

    const withPhone = await patch(identity, id, { customer: { phone: '(11) 99999-8888' } });

    deepEqual(withPhone.customer, { id: customerId, name: 'Maria', phone: '5511999998888' });

    const nameOnly = await patch(identity, id, { customer: { name: 'João' } });

    deepEqual(nameOnly.customer, { id: null, name: 'João', phone: null });

    equal((await patch(identity, id, { customer: null })).customer, null);

    await rejects(patch(identity, id, { customer: { phone: '123' } }), withField(HttpBadRequestError, 'customer'));
  });

  it('refuses writes on a store that is blocked', async () => {
    const { storeId, identity } = await setup();

    await db.stores.updateOne({ data: { billing_blocked: true }, where: { id: storeId } });

    await rejects(create(identity), HttpForbiddenError);
  });

  it('lists only held POS sales', async () => {
    const { storeId, menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const scope = { storeId, ...(await seedConversation(db, storeId)) };

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    const { id } = await create(identity, randomUUID(), 'Mesa 4');

    await add(identity, id, { productId: coca.id, qty: 2, selections: [] });

    const { sales } = (await listPosSalesHandler({ identity, query: {} } as never, { db })).body;

    deepEqual(
      sales.map(({ id, label, itemsCount, totalCents }) => ({ id, label, itemsCount, totalCents })),
      [{ id, label: 'Mesa 4', itemsCount: 2, totalCents: coca.price_cents * 2 }]
    );

    await discardPosSaleHandler({ identity, parameters: { saleId: id } } as never, { db });

    equal((await listPosSalesHandler({ identity, query: {} } as never, { db })).body.sales.length, 0);
    equal(await db.order_items.count({ where: { order_id: id } }), 0);
  });

  it("does not return another store's sale", async () => {
    const { identity } = await setup();
    const other = await setup();
    const { id } = await create(other.identity);

    await rejects(getPosSaleHandler({ identity, parameters: { saleId: id } } as never, { db }), HttpNotFoundError);
    await rejects(patch(identity, id, { label: 'x' }), HttpNotFoundError);
    await rejects(create(identity, id), HttpNotFoundError);
  });

  it('refuses writes on a sale that is no longer a draft', async () => {
    const { identity } = await setup();
    const { id } = await create(identity);

    await db.orders.updateOne({ data: { status: OrderStatus.Done }, where: { id } });

    await rejects(patch(identity, id, { label: 'x' }), withField(HttpConflictError, 'not_draft'));
  });

  it("keeps POS sales out of the bot's previous order", async () => {
    const { storeId, menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const scope = { storeId, ...(await seedConversation(db, storeId)) };
    const phone = (await db.customers.findOne({ select: { phone: true }, where: { id: scope.customerId } }))!.phone;

    const { id } = await create(identity);

    await add(identity, id, { productId: coca.id, qty: 1, selections: [] });
    await patch(identity, id, { customer: { phone } });
    await db.orders.updateOne({
      data: { status: OrderStatus.Done, placed_at: new Date().toISOString() },
      where: { id }
    });

    equal((await PosRepository.getSale(db, storeId, id)).customer?.id, scope.customerId);
    equal(await OrderRepository.findPreviousOrder(db, scope, [OrderStatus.Done]), undefined);
  });

  it('serves the POS menu with kitchen flags', async () => {
    const { storeId, menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const hidden = menu.find(({ id }) => id !== coca.id)!;
    const categoryId = (await db.products.findOne({ select: { category_id: true }, where: { id: coca.id } }))!
      .category_id;

    await MenuRepository.setProductActive(db, storeId, hidden.id, false);
    await MenuRepository.setCategoryPreparation(db, storeId, categoryId, true);

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);

    const { categories } = (await getPosMenuHandler({ identity } as never, { db, productImages })).body;
    const products = categories.flatMap(({ products }) => products);

    equal(
      products.some(({ id }) => id === hidden.id),
      false
    );
    equal(products.find(({ id }) => id === coca.id)?.soldOut, true);
    equal(products.find(({ id }) => id === coca.id)?.needsPreparation, null);
    equal(categories.find(({ id }) => id === categoryId)?.needsPreparation, true);
    equal(
      categories.filter(({ id }) => id !== categoryId).every(({ needsPreparation }) => needsPreparation === false),
      true
    );
  });

  it('computes whether the sale needs the kitchen', async () => {
    const { storeId, menu, identity } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');
    const categoryId = (await db.products.findOne({ select: { category_id: true }, where: { id: coca.id } }))!
      .category_id;
    const { id } = await create(identity);

    equal((await add(identity, id, { productId: coca.id, qty: 1, selections: [] })).needsPreparation, false);

    await MenuRepository.setCategoryPreparation(db, storeId, categoryId, true);

    equal((await PosRepository.getSale(db, storeId, id)).needsPreparation, true);
  });
});
