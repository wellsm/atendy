import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { BillingRepository } from '../../src/billing/repository';
import { ConversationRepository } from '../../src/conversations/repository';
import { MessageAuthor } from '../../src/conversations/types';
import { OrderRepository } from '../../src/orders/repository';
import { Fulfillment } from '../../src/orders/types';
import { buildDashboard } from '../../src/panel/dashboard';
import { localMonth } from '../../src/payments/cycle';
import { PaymentMethod } from '../../src/stores/types';
import { minutesAgo, placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('panel dashboard', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('counts the month cycles, how far they got, how they ended, and the cost', async () => {
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { order_price_cents: 100 }, where: { id: storeId } });

    const menu = await seedMenu(db, storeId);
    const coke = productByName(menu, 'Coca-Cola 2L');

    const cycle = async () => {
      const { conversationId, customerId } = await seedConversation(db, storeId);

      await ConversationRepository.recordOutbound(db, {
        storeId,
        conversationId,
        author: MessageAuthor.Bot,
        body: 'Olá!',
        providerMessageId: `BOT-${conversationId}`
      });

      return { storeId, conversationId, customerId };
    };

    // Placed by the bot: 100 %.
    const bot = await cycle();
    const botOrder = await placeOrder(db, bot, menu);

    await BillingRepository.recordPlaced(db, { ...bot, orderId: botOrder });

    // Handed off after items and pickup: 70 %.
    const handoff = await cycle();

    await OrderRepository.addItem(db, handoff, { product: coke, qty: 1, selections: [] });
    await OrderRepository.setFulfillment(db, handoff, Fulfillment.Pickup);
    await ConversationRepository.handOffToHuman(db, {
      conversationId: handoff.conversationId,
      reason: 'customer_asked'
    });

    // Our failure before any item: 0 %.
    const failure = await cycle();

    await ConversationRepository.handOffToHuman(db, {
      conversationId: failure.conversationId,
      reason: 'technical_error'
    });

    // Left with items and delivery chosen: abandoned, not billed.
    const left = await cycle();

    await OrderRepository.addItem(db, left, { product: coke, qty: 1, selections: [] });
    await OrderRepository.setFulfillment(db, left, Fulfillment.Delivery);
    await db.conversations.updateOne({
      data: { last_message_at: minutesAgo(5 * 60) },
      where: { id: left.conversationId }
    });

    // Placed by the store alone: no billing, outside the funnel.
    const store = await seedConversation(db, storeId);

    await OrderRepository.addItem(db, { storeId, ...store }, { product: coke, qty: 1, selections: [] });
    await OrderRepository.setFulfillment(db, { storeId, ...store }, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, { storeId, ...store }, { method: PaymentMethod.Pix });
    await OrderRepository.place(db, { storeId, ...store }, { byStaff: true });

    const now = new Date();
    const dashboard = await buildDashboard(db, storeId, localMonth(now), now);

    deepEqual(
      { ...dashboard.totals, forecastCents: undefined },
      {
        conversations: 4,
        placedByBot: 1,
        placedByStore: 1,
        placedByWeb: 0,
        handoffs: 1,
        abandoned: 1,
        failures: 1,
        costCents: 170,
        forecastCents: undefined,
        costPerOrderCents: 170
      }
    );

    deepEqual(dashboard.funnel, [
      { step: 'conversation', count: 4 },
      { step: 'items', count: 3 },
      { step: 'fulfillment', count: 3 },
      { step: 'address', count: 2 },
      { step: 'payment', count: 1 },
      { step: 'placed', count: 1 }
    ]);
    deepEqual(dashboard.handoffReasons, [{ reason: 'customer_asked', count: 1 }]);
    equal(
      dashboard.days.reduce((total, { orders }) => total + orders, 0),
      2
    );
  });
});
