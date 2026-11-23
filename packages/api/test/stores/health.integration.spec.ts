import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { OrderStatus } from '../../src/orders/types';
import { StoreRepository } from '../../src/stores/repository';
import { minutesAgo, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('StoreRepository.getHealth', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const order = async (
    storeId: string,
    scope: { conversationId: string | null; customerId: string },
    input: { placedAt: string | null; status: OrderStatus }
  ) => {
    const now = new Date().toISOString();

    await db.orders.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        customer_id: scope.customerId,
        conversation_id: scope.conversationId,
        status: input.status,
        subtotal_cents: 5000,
        fee_cents: 0,
        total_cents: 5000,
        placed_at: input.placedAt,
        created_at: now,
        updated_at: now
      }
    });
  };

  const conversation = async (storeId: string, input: { reason: string | null; minutes: number }) => {
    const { conversationId } = await seedConversation(db, storeId);

    await db.conversations.updateOne({
      data: { handoff_reason: input.reason, last_message_at: minutesAgo(input.minutes) },
      where: { id: conversationId }
    });

    return conversationId;
  };

  it('is empty for a store without conversations or menu', async () => {
    const { storeId } = await seedStore(db);

    deepEqual(await StoreRepository.getHealth(db, storeId), {
      lastMessageAt: null,
      errorCount24h: 0,
      recentErrors: [],
      activeProducts: 0,
      orders30d: 0
    });
  });

  it('counts recent error conversations of the store only', async () => {
    const { storeId } = await seedStore(db);
    const other = await seedStore(db);

    await conversation(storeId, { reason: null, minutes: 5 });
    const sendFailed = await conversation(storeId, { reason: 'send_failed', minutes: 30 });
    const technical = await conversation(storeId, { reason: 'technical_error', minutes: 10 });
    await conversation(storeId, { reason: 'customer_asked', minutes: 20 });
    await conversation(storeId, { reason: 'technical_error', minutes: 25 * 60 });
    await conversation(other.storeId, { reason: 'technical_error', minutes: 1 });

    const health = await StoreRepository.getHealth(db, storeId);

    equal(health.lastMessageAt, minutesAgoRounded(health.lastMessageAt));
    equal(health.errorCount24h, 2);
    deepEqual(
      health.recentErrors.map(({ conversationId, reason }) => [conversationId, reason]),
      [
        [technical, 'technical_error'],
        [sendFailed, 'send_failed']
      ]
    );
  });

  it('keeps the five most recent errors', async () => {
    const { storeId } = await seedStore(db);

    for (let index = 0; index < 7; index++) {
      await conversation(storeId, { reason: 'send_failed', minutes: index + 1 });
    }

    const health = await StoreRepository.getHealth(db, storeId);

    equal(health.errorCount24h, 7);
    equal(health.recentErrors.length, 5);
  });

  it('counts orders placed in the last 30 days, canceled ones and other stores left out', async () => {
    const { storeId } = await seedStore(db);
    const other = await seedStore(db);
    const scope = await seedConversation(db, storeId);
    const otherScope = await seedConversation(db, other.storeId);
    const day = 24 * 60;

    await order(storeId, scope, { placedAt: minutesAgo(10), status: OrderStatus.Placed });
    await order(storeId, scope, { placedAt: minutesAgo(29 * day), status: OrderStatus.Done });
    await order(storeId, { ...scope, conversationId: null }, { placedAt: minutesAgo(day), status: OrderStatus.Done });
    await order(storeId, scope, { placedAt: minutesAgo(31 * day), status: OrderStatus.Done });
    await order(storeId, scope, { placedAt: minutesAgo(10), status: OrderStatus.Canceled });
    await order(storeId, scope, { placedAt: null, status: OrderStatus.Draft });
    await order(other.storeId, otherScope, { placedAt: minutesAgo(10), status: OrderStatus.Placed });

    equal((await StoreRepository.getHealth(db, storeId)).orders30d, 3);
  });

  it('counts active products', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    await db.products.updateOne({ data: { active: false }, where: { id: menu[0]!.id } });

    equal((await StoreRepository.getHealth(db, storeId)).activeProducts, menu.length - 1);
  });
});

/**
 * The newest conversation (5 minutes ago) sets the last message.
 */
const minutesAgoRounded = (value: string | null) => {
  equal(typeof value, 'string');

  const age = Date.now() - new Date(value!).getTime();

  equal(age > 4 * 60_000 && age < 6 * 60_000, true);

  return value;
};
