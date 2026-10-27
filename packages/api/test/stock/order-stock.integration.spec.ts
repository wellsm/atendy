import type { Db } from '../../src/db';
import type { MenuProduct } from '../../src/menu/repository';
import type { DraftScope } from '../../src/orders/repository';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { OrderError, OrderErrorCode, OrderRepository } from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { StockRepository } from '../../src/stock/repository';
import { StockMovementKind, StockUnit } from '../../src/stock/types';
import { StoreRepository } from '../../src/stores/repository';
import { OrderCodeMode, PaymentMethod } from '../../src/stores/types';
import { groupIdOf, optionIdOf, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

const outOfStock = (names: string) => (error: unknown) =>
  error instanceof OrderError && error.code === OrderErrorCode.OutOfStock && error.message === `Out of stock: ${names}`;

describe('orders move stock', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (balance: number) => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const coca = productByName(menu, 'Coca-Cola 2L');

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca 2L',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);

    if (balance > 0) {
      await StockRepository.recordEntry(db, storeId, { itemId: item.id, qty: balance, author: 'test' });
    }

    return { storeId, menu, coca, itemId: item.id };
  };

  const scopeFor = async (storeId: string): Promise<DraftScope> => ({
    storeId,
    ...(await seedConversation(db, storeId))
  });

  const fillDraft = async (scope: DraftScope, product: MenuProduct, qty: number, byStaff?: boolean) => {
    await OrderRepository.addItem(db, scope, {
      product,
      qty,
      selections: [],
      ...(byStaff && { byStaff, skipLimits: true })
    });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });
  };

  const balanceOf = async (itemId: string) =>
    (await db.stock_items.findOne({ select: { balance: true }, where: { id: itemId } }))?.balance;

  const saleMovements = async (itemId: string) => {
    const { records } = await db.stock_movements.findMany({
      select: { kind: true, qty_delta: true, order_id: true, author: true, created_at: true },
      where: { stock_item_id: itemId, kind: { isIn: [StockMovementKind.Sale, StockMovementKind.SaleReturn] } }
    });

    return records.sort((a, b) => a.created_at.localeCompare(b.created_at));
  };

  const orderStatus = async (orderId: string) =>
    (await db.orders.findOne({ select: { status: true }, where: { id: orderId } }))?.status;

  it('deducts on placement, with one sale movement of the order', async () => {
    const { storeId, coca, itemId } = await setup(5);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    equal(await balanceOf(itemId), 5);

    const placed = await OrderRepository.place(db, scope);

    equal(placed.status, OrderStatus.Placed);
    equal(await balanceOf(itemId), 4);

    const movements = await saleMovements(itemId);

    equal(movements.length, 1);
    equal(movements[0]!.kind, StockMovementKind.Sale);
    equal(movements[0]!.qty_delta, -1);
    equal(movements[0]!.order_id, placed.order_id);
    equal(movements[0]!.author, 'system');
  });

  it('stores the frozen usage of the product and the selected options on the line', async () => {
    const { storeId, menu, itemId } = await setup(5);
    const pizza = productByName(menu, 'Pizza Grande');

    const cheese = await StockRepository.createItem(db, storeId, {
      name: 'Calabresa (g)',
      unit: StockUnit.Gram,
      barcode: null,
      minQty: null
    });

    const calabresa = optionIdOf(pizza, 'Sabores', 'Calabresa');

    await StockRepository.setLinks(db, storeId, { optionId: calabresa }, [{ stockItemId: cheese.id, qty: 150 }]);
    await StockRepository.setLinks(db, storeId, { productId: pizza.id }, [{ stockItemId: itemId, qty: 2 }]);

    const scope = await scopeFor(storeId);

    const cart = await OrderRepository.addItem(db, scope, {
      product: pizza,
      qty: 1,
      selections: [{ group_id: groupIdOf(pizza, 'Sabores'), option_ids: [calabresa] }]
    });

    const line = await db.order_items.findOne({ select: { stock_usage: true }, where: { id: cart.items[0]!.item_id } });

    deepEqual(
      line?.stock_usage,
      [
        { stock_item_id: itemId, qty: 2 },
        { stock_item_id: cheese.id, qty: 150 }
      ].sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1))
    );
  });

  for (const from of [OrderStatus.Placed, OrderStatus.Accepted]) {
    it(`returns the stock when the store cancels a ${from} order`, async () => {
      const { storeId, coca, itemId } = await setup(5);
      const scope = await scopeFor(storeId);

      await fillDraft(scope, coca, 1);

      const { order_id: orderId } = await OrderRepository.place(db, scope);

      if (from === OrderStatus.Accepted) {
        await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Accepted });
      }

      equal(await balanceOf(itemId), 4);

      await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Canceled });

      equal(await balanceOf(itemId), 5);

      const returns = (await saleMovements(itemId)).filter(({ kind }) => kind === StockMovementKind.SaleReturn);

      equal(returns.length, 1);
      equal(returns[0]!.qty_delta, 1);
      equal(returns[0]!.order_id, orderId);
    });
  }

  it('moves the difference when the bot edits a placed order', async () => {
    const { storeId, coca, itemId } = await setup(5);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);
    await OrderRepository.place(db, scope);

    const cart = await OrderRepository.addItem(db, scope, { product: coca, qty: 2, selections: [] });

    equal(cart.status, OrderStatus.Placed);
    equal(await balanceOf(itemId), 2);

    // An edit that does not touch the items moves nothing.
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    equal(await balanceOf(itemId), 2);

    await OrderRepository.removeItem(db, scope, cart.items[1]!.item_id);

    equal(await balanceOf(itemId), 4);

    deepEqual(
      (await saleMovements(itemId)).map(({ kind, qty_delta }) => [kind, qty_delta]),
      [
        [StockMovementKind.Sale, -1],
        [StockMovementKind.Sale, -2],
        [StockMovementKind.SaleReturn, 2]
      ]
    );
  });

  it('refuses a placement the stock cannot cover, without using an order number', async () => {
    const { storeId, coca, itemId } = await setup(0);

    await StoreRepository.setOrderCodeMode(db, storeId, OrderCodeMode.Sequential);

    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    const draftId = (await OrderRepository.findDraftId(db, scope.conversationId))!;
    const seqBefore = (await db.stores.findOne({ select: { order_seq: true }, where: { id: storeId } }))?.order_seq;

    await rejects(OrderRepository.place(db, scope), outOfStock('Coca-Cola 2L'));

    equal(await orderStatus(draftId), OrderStatus.Draft);
    equal(await OrderRepository.findDraftId(db, scope.conversationId), draftId);
    equal(await balanceOf(itemId), 0);
    equal((await saleMovements(itemId)).length, 0);

    const seqAfter = (await db.stores.findOne({ select: { order_seq: true }, where: { id: storeId } }))?.order_seq;

    equal(seqAfter, seqBefore);
  });

  it('names only the option whose item ran out, not the rest of the line', async () => {
    const { storeId, menu, itemId } = await setup(5);
    const pizza = productByName(menu, 'Pizza Grande');
    const calabresa = optionIdOf(pizza, 'Sabores', 'Calabresa');

    const sausage = await StockRepository.createItem(db, storeId, {
      name: 'Calabresa (g)',
      unit: StockUnit.Gram,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: pizza.id }, [{ stockItemId: itemId, qty: 1 }]);
    await StockRepository.setLinks(db, storeId, { optionId: calabresa }, [{ stockItemId: sausage.id, qty: 150 }]);

    const scope = await scopeFor(storeId);

    await OrderRepository.addItem(db, scope, {
      product: pizza,
      qty: 1,
      selections: [{ group_id: groupIdOf(pizza, 'Sabores'), option_ids: [calabresa] }]
    });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    await rejects(OrderRepository.place(db, scope), outOfStock('Calabresa'));
  });

  it('refuses a bot edit of a placed order beyond the stock and keeps the order as it was', async () => {
    const { storeId, coca, itemId } = await setup(1);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    const { order_id: orderId } = await OrderRepository.place(db, scope);

    await rejects(
      OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] }),
      outOfStock('Coca-Cola 2L')
    );

    equal((await db.order_items.findMany({ select: { id: true }, where: { order_id: orderId } })).records.length, 1);
    equal(await balanceOf(itemId), 0);
    equal((await saleMovements(itemId)).length, 1);
  });

  it('refuses an addition to an accepted order beyond the stock', async () => {
    const { storeId, coca, itemId } = await setup(1);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    const { order_id: orderId } = await OrderRepository.place(db, scope);

    await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Accepted });

    await rejects(
      OrderRepository.addToAcceptedOrder(db, scope, { product: coca, qty: 1, selections: [] }),
      outOfStock('Coca-Cola 2L')
    );

    equal((await db.order_items.findMany({ select: { id: true }, where: { order_id: orderId } })).records.length, 1);
    equal(await balanceOf(itemId), 0);
  });

  it('deducts an addition to an accepted order the stock covers', async () => {
    const { storeId, coca, itemId } = await setup(3);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    const { order_id: orderId } = await OrderRepository.place(db, scope);

    await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Accepted });
    await OrderRepository.addToAcceptedOrder(db, scope, { product: coca, qty: 2, selections: [] });

    equal(await balanceOf(itemId), 0);
  });

  it('lets the attendant sell beyond the stock: the balance goes negative', async () => {
    const { storeId, coca, itemId } = await setup(0);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1, true);

    const placed = await OrderRepository.place(db, scope, { byStaff: true });

    equal(placed.status, OrderStatus.Placed);
    equal(await balanceOf(itemId), -1);

    // An attendant edit of the placed order never fails for stock either.
    await OrderRepository.addItem(db, scope, {
      product: coca,
      qty: 2,
      selections: [],
      byStaff: true,
      skipLimits: true
    });

    equal(await balanceOf(itemId), -3);
  });

  it('sells the last unit to only one of two parallel placements', async () => {
    const { storeId, coca, itemId } = await setup(1);
    const first = await scopeFor(storeId);
    const second = await scopeFor(storeId);

    await fillDraft(first, coca, 1);
    await fillDraft(second, coca, 1);

    const results = await Promise.allSettled([OrderRepository.place(db, first), OrderRepository.place(db, second)]);

    equal(results.filter(({ status }) => status === 'fulfilled').length, 1);

    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

    ok(rejected && outOfStock('Coca-Cola 2L')(rejected.reason));
    equal(await balanceOf(itemId), 0);
    equal((await saleMovements(itemId)).length, 1);
  });

  it('returns what the line froze, even after the links changed and the item was archived', async () => {
    const { storeId, coca, itemId } = await setup(5);
    const scope = await scopeFor(storeId);

    await fillDraft(scope, coca, 1);

    const { order_id: orderId } = await OrderRepository.place(db, scope);

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: itemId, qty: 6 }]);
    await StockRepository.archiveItem(db, storeId, itemId);
    await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Canceled });

    const returns = (await saleMovements(itemId)).filter(({ kind }) => kind === StockMovementKind.SaleReturn);

    equal(returns.length, 1);
    equal(returns[0]!.qty_delta, 1);
    equal(await balanceOf(itemId), 5);
  });

  it('moves nothing for lines without links or with no frozen usage', async () => {
    const { storeId, menu, coca, itemId } = await setup(5);
    const guarana = productByName(menu, 'Guaraná Antarctica 2L');

    const withoutLinks = await scopeFor(storeId);

    await fillDraft(withoutLinks, guarana, 2);

    const { order_id: firstId } = await OrderRepository.place(db, withoutLinks);

    equal(
      (await db.stock_movements.findMany({ select: { id: true }, where: { order_id: firstId } })).records.length,
      0
    );

    // A line written before stock existed.
    const oldLine = await scopeFor(storeId);

    await fillDraft(oldLine, coca, 1);

    const draftId = (await OrderRepository.findDraftId(db, oldLine.conversationId))!;

    await db.order_items.updateMany({ data: { stock_usage: null }, where: { order_id: draftId } });

    await OrderRepository.place(db, oldLine);
    await OrderRepository.setStatus(db, { storeId, orderId: draftId, status: OrderStatus.Canceled });

    equal(
      (await db.stock_movements.findMany({ select: { id: true }, where: { order_id: draftId } })).records.length,
      0
    );
    equal(await balanceOf(itemId), 5);
  });
});
