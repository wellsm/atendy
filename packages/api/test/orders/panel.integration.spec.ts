import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import {
  OrderError,
  OrderErrorCode,
  OrderRepository,
  OrderStatusError,
  OrderStatusErrorCode,
  PanelOrderScope
} from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('OrderRepository (panel)', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const scope = { storeId, conversationId, customerId };
    const orderId = await placeOrder(db, scope, menu);

    return { scope, menu, orderId };
  };

  const isStatusError = (code: OrderStatusErrorCode) => (error: unknown) =>
    error instanceof OrderStatusError && error.code === code;

  it('moves an order through the store flow and returns what the notification needs', async () => {
    const { scope, orderId } = await setup();

    const accepted = await OrderRepository.setStatus(db, {
      storeId: scope.storeId,
      orderId,
      status: OrderStatus.Accepted
    });

    equal(accepted.conversationId, scope.conversationId);
    equal(accepted.fulfillment, Fulfillment.Pickup);

    await OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Out });
    await OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Done });

    const order = await db.orders.findOne({ select: { status: true }, where: { id: orderId } });

    equal(order?.status, OrderStatus.Done);
  });

  it('refuses a jump, a final state and another store order', async () => {
    const { scope, orderId } = await setup();
    const other = await seedStore(db);

    await rejects(
      OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Done }),
      isStatusError(OrderStatusErrorCode.InvalidTransition)
    );

    await rejects(
      OrderRepository.setStatus(db, { storeId: other.storeId, orderId, status: OrderStatus.Accepted }),
      isStatusError(OrderStatusErrorCode.NotFound)
    );

    await rejects(
      OrderRepository.setStatus(db, { storeId: scope.storeId, orderId: randomUUID(), status: OrderStatus.Accepted }),
      isStatusError(OrderStatusErrorCode.NotFound)
    );

    await OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Canceled });

    await rejects(
      OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Accepted }),
      isStatusError(OrderStatusErrorCode.InvalidTransition)
    );
  });

  it('keeps an accepted order out of the agent: new items go to a new draft', async () => {
    const { scope, menu, orderId } = await setup();

    await OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Accepted });

    await OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });

    equal(await db.order_items.count({ where: { order_id: orderId } }), 1);
    ok(await OrderRepository.findDraftId(db, scope.conversationId));
  });

  it('serialises a store accept with an agent edit of the same order', async () => {
    const { scope, orderId } = await setup();

    const edit = async () => {
      try {
        await OrderRepository.editPlacedOrder(db, orderId, async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
        });

        return 'edited';
      } catch (error) {
        if (error instanceof OrderError && error.code === OrderErrorCode.OrderLocked) {
          return 'locked';
        }

        throw error;
      }
    };

    const accept = OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Accepted });

    const [outcome] = await Promise.all([edit(), accept]);

    const order = await db.orders.findOne({ select: { status: true, amended_at: true }, where: { id: orderId } });

    equal(order?.status, OrderStatus.Accepted);
    // Either the edit committed before the accept (amended) or it saw the accept and was refused.
    equal(!!order?.amended_at, outcome === 'edited');
  });

  it('treats a draft as not found for the store', async () => {
    const { scope, menu, orderId } = await setup();

    // Once the placed order is accepted, the next item opens a new draft.
    await OrderRepository.setStatus(db, { storeId: scope.storeId, orderId, status: OrderStatus.Accepted });
    await OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });

    const draftId = await OrderRepository.findDraftId(db, scope.conversationId);

    ok(draftId);

    await rejects(
      OrderRepository.setStatus(db, { storeId: scope.storeId, orderId: draftId, status: OrderStatus.Accepted }),
      isStatusError(OrderStatusErrorCode.NotFound)
    );
  });

  it('lists open orders oldest first and closed orders newest first, with items and customer', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    const place = async () => {
      const { conversationId, customerId } = await seedConversation(db, storeId);

      return placeOrder(db, { storeId, conversationId, customerId }, menu);
    };

    const first = await place();
    const second = await place();
    const third = await place();

    await OrderRepository.setStatus(db, { storeId, orderId: second, status: OrderStatus.Accepted });
    await OrderRepository.setStatus(db, { storeId, orderId: third, status: OrderStatus.Canceled });

    const open = await OrderRepository.listForPanel(db, storeId, PanelOrderScope.Open);

    deepEqual(
      open.map(({ id }) => id),
      [first, second]
    );

    equal(open[0]!.items.length, 1);
    equal(open[0]!.items[0]!.product_name, 'Coca-Cola 2L');
    ok(open[0]!.customer.phone);

    const closed = await OrderRepository.listForPanel(db, storeId, PanelOrderScope.Closed);

    deepEqual(
      closed.map(({ id }) => id),
      [third]
    );

    const otherStore = await seedStore(db);

    deepEqual(await OrderRepository.listForPanel(db, otherStore.storeId, PanelOrderScope.Open), []);

    equal((await OrderRepository.getForPanel(db, storeId, first))?.id, first);
    equal(await OrderRepository.getForPanel(db, otherStore.storeId, first), undefined);
  });
});
