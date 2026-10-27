import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { OrderRepository, PanelOrderScope } from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { minutesAgo, placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('abandoned drafts', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const { storeId } = await seedStore(db, { policy: { order_memory_hours: 3 } });
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const scope = { storeId, conversationId, customerId };

    const draftWithCoke = async () =>
      (
        await OrderRepository.addItem(db, scope, {
          product: productByName(menu, 'Coca-Cola 2L'),
          qty: 1,
          selections: []
        })
      ).order_id;

    const lastMessage = (iso: string) =>
      db.conversations.updateOne({ data: { last_message_at: iso }, where: { id: conversationId } });

    return { storeId, scope, menu, draftWithCoke, lastMessage };
  };

  const statusOf = async (orderId: string) =>
    (await db.orders.findOne({ select: { status: true, abandoned_at: true }, where: { id: orderId } }))!;

  it('abandons the draft when the customer comes back after the memory window', async () => {
    const { scope, draftWithCoke } = await setup();
    const orderId = await draftWithCoke();
    const stopped = minutesAgo(4 * 60);

    const recent = await OrderRepository.abandonIfStale(db, {
      conversationId: scope.conversationId,
      lastActivity: minutesAgo(60),
      memorySince: minutesAgo(3 * 60)
    });

    equal(recent, false);

    const stale = await OrderRepository.abandonIfStale(db, {
      conversationId: scope.conversationId,
      lastActivity: stopped,
      memorySince: minutesAgo(3 * 60)
    });

    equal(stale, true);
    deepEqual(await statusOf(orderId), { status: OrderStatus.Abandoned, abandoned_at: stopped });
    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);
  });

  it('sweeps drafts of customers who never came back, lists them in the history and marks the thread', async () => {
    const { storeId, scope, menu, draftWithCoke, lastMessage } = await setup();
    const placedId = await placeOrder(db, scope, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Done }, where: { id: placedId } });

    const draftId = await draftWithCoke();

    await lastMessage(minutesAgo(60));

    equal(await OrderRepository.abandonStaleDrafts(db, new Date(), storeId), 0);

    await lastMessage(minutesAgo(5 * 60));

    const closed = await OrderRepository.listForPanel(db, storeId, PanelOrderScope.Closed);

    deepEqual(
      closed.map(({ id, status }) => ({ id, status })),
      [
        { id: placedId, status: OrderStatus.Done },
        { id: draftId, status: OrderStatus.Abandoned }
      ]
    );

    // The thread marks both orders, oldest first: the done order (placed now) after the draft the customer left.
    const marks = await OrderRepository.marksForConversation(db, scope.conversationId);

    deepEqual(
      marks.map(({ id }) => id),
      [draftId, placedId]
    );
  });

  it('does not list drafts abandoned before any item', async () => {
    const { storeId, scope, lastMessage } = await setup();

    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await lastMessage(minutesAgo(5 * 60));

    equal(await OrderRepository.abandonStaleDrafts(db, new Date(), storeId), 1);

    const closed = await OrderRepository.listForPanel(db, storeId, PanelOrderScope.Closed);

    deepEqual(closed, []);
  });
});
