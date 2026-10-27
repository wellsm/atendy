import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { BillingStep } from '../../src/billing/progress';
import { BillingRepository } from '../../src/billing/repository';
import { BillingOutcome } from '../../src/billing/types';
import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { OrderRepository } from '../../src/orders/repository';
import { Fulfillment } from '../../src/orders/types';
import { PaymentMethod } from '../../src/stores/types';
import { productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('BillingRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (price?: number) => {
    const { storeId } = await seedStore(db);

    if (price !== undefined) {
      await db.stores.updateOne({ data: { order_price_cents: price }, where: { id: storeId } });
    }

    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const scope = { storeId, conversationId, customerId };

    const addCoke = () =>
      OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });

    return { scope, addCoke };
  };

  const records = async (conversationId: string) => {
    const { records: rows } = await db.billing_records.findMany({
      select: { order_id: true, outcome: true, handoff_reason: true, steps: true, percent: true, amount_cents: true },
      where: { conversation_id: conversationId }
    });

    return rows;
  };

  const handOff = (conversationId: string, reason: string) =>
    ConversationRepository.handOffToHuman(db, { conversationId, reason });

  const botReplies = (scope: { storeId: string; conversationId: string }) =>
    ConversationRepository.recordOutbound(db, {
      ...scope,
      author: MessageAuthor.Bot,
      body: 'Olá! O que vai ser?',
      providerMessageId: `BOT-${Math.random()}`
    });

  it('bills nothing when the store served the customer alone (the bot never answered in the cycle)', async () => {
    const { scope } = await setup();

    await ConversationRepository.setMode(db, {
      conversationId: scope.conversationId,
      mode: ConversationMode.Human,
      reason: 'staff_took_over'
    });

    deepEqual(await records(scope.conversationId), []);
  });

  it('bills a handoff by what the AI finished in the draft, rounding up', async () => {
    const { scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await handOff(scope.conversationId, 'agent_requested');

    const [row] = await records(scope.conversationId);

    equal(row?.outcome, BillingOutcome.Handoff);
    equal(row?.handoff_reason, 'agent_requested');
    deepEqual(row?.steps, [BillingStep.Items, BillingStep.Fulfillment, BillingStep.Address]);
    equal(row?.percent, 70);
    equal(row?.amount_cents, 35);
  });

  it('keeps one row per order cycle: an early handoff, then the bot places the order', async () => {
    const { scope, addCoke } = await setup(99);

    await botReplies(scope);
    await handOff(scope.conversationId, 'agent_requested');
    await handOff(scope.conversationId, 'staff_replied_from_phone');

    deepEqual(
      (await records(scope.conversationId)).map(({ percent, amount_cents }) => [percent, amount_cents]),
      [[10, 10]]
    );

    await ConversationRepository.setMode(db, { conversationId: scope.conversationId, mode: ConversationMode.Bot });
    await addCoke();
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const placed = await OrderRepository.place(db, scope);

    await BillingRepository.recordPlaced(db, { ...scope, orderId: placed.order_id });

    const [row, ...rest] = await records(scope.conversationId);

    equal(rest.length, 0);
    equal(row?.order_id, placed.order_id);
    equal(row?.outcome, BillingOutcome.Placed);
    equal(row?.percent, 100);
    equal(row?.amount_cents, 99);

    // Asking for a person about the order just placed bills nothing more.
    await handOff(scope.conversationId, 'agent_requested');
    await BillingRepository.recordPlaced(db, { ...scope, orderId: placed.order_id });

    equal((await records(scope.conversationId)).length, 1);
  });

  it('charges nothing for our failures, but never lowers what was already billed', async () => {
    const { scope } = await setup();

    await botReplies(scope);
    await handOff(scope.conversationId, 'technical_error');

    deepEqual(
      (await records(scope.conversationId)).map(({ percent }) => percent),
      [0]
    );

    const other = await setup();

    await other.addCoke();
    await handOff(other.scope.conversationId, 'staff_took_over');
    await handOff(other.scope.conversationId, 'send_failed');

    deepEqual(
      (await records(other.scope.conversationId)).map(({ percent }) => percent),
      [40]
    );
  });
});
