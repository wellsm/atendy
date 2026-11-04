import type { Db } from '../../src/db';

import { equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { AiCallRepository } from '../../src/agent/repository';
import { AiPath, AiProvider } from '../../src/agent/types';
import { BillingRepository } from '../../src/billing/repository';
import { resetAdminDemoStoreHandler } from '../../src/demo/endpoints/reset-store';
import { PosRepository } from '../../src/pos/repository';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { PaymentMethod } from '../../src/stores/types';
import { placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('demo reset', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const identity = { userId: 'user_admin' };

  afterEach(() => {
    process.env.DEMO_ENABLED = 'true';
  });

  const reset = (storeId: string, slug: string) =>
    resetAdminDemoStoreHandler({ identity, parameters: { storeId }, body: { slug } } as never, { db });

  const balanceOf = async (itemId: string) =>
    (await db.stock_items.findOne({ select: { balance: true }, where: { id: itemId } }))?.balance;

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    // Counter sales without a cash session.
    await db.stores.updateOne({ data: { pos_cash_control: false }, where: { id: storeId } });
    const coca = productByName(menu, 'Coca-Cola 2L');
    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca 2L',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);
    await StockRepository.recordEntry(db, storeId, { itemId: item.id, qty: 10, author: 'test' });

    const store = await db.stores.findOne({ select: { slug: true }, where: { id: storeId } });

    return { storeId, slug: store!.slug, menu, coca, itemId: item.id };
  };

  it('deletes the conversations, their orders, billing and AI calls, and gives the stock back', async () => {
    const { storeId, slug, menu, coca, itemId } = await setup();
    const scope = { storeId, ...(await seedConversation(db, storeId)) };
    const orderId = await placeOrder(db, scope, menu);

    await BillingRepository.recordPlaced(db, { storeId, conversationId: scope.conversationId, orderId });
    await AiCallRepository.record(db, {
      storeId,
      conversationId: scope.conversationId,
      provider: AiProvider.OpenRouter,
      model: 'test/model',
      path: AiPath.LlmFallback,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.001,
      latencyMs: 1
    });

    // A counter sale and its customer stay.
    const sale = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });
    await PosRepository.addLine(db, storeId, sale.id, { product: coca, qty: 1, selections: [] });
    await PosRepository.finalize(db, storeId, sale.id, {
      payments: [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }],
      author: 'user_1'
    });

    // Another store is never touched.
    const other = await setup();
    const otherScope = { storeId: other.storeId, ...(await seedConversation(db, other.storeId)) };
    await placeOrder(db, otherScope, other.menu);

    equal(await balanceOf(itemId), 8);

    const { body } = await reset(storeId, slug);

    equal(body.conversations, 1);
    equal(body.orders, 1);
    equal(body.customers, 1);

    equal(await db.conversations.count({ where: { store_id: storeId } }), 0);
    equal(await db.messages.count({ where: { store_id: storeId } }), 0);
    equal(await db.customers.count({ where: { store_id: storeId } }), 0);
    equal(await db.orders.count({ where: { id: orderId } }), 0);
    equal(await db.order_items.count({ where: { order_id: orderId } }), 0);
    equal(await db.stock_movements.count({ where: { order_id: orderId } }), 0);
    equal(await db.billing_records.count({ where: { store_id: storeId } }), 0);
    equal(await db.ai_calls.count({ where: { store_id: storeId } }), 0);

    // Only the counter sale still holds stock.
    equal(await balanceOf(itemId), 9);
    equal(await db.orders.count({ where: { id: sale.id } }), 1);

    equal(await db.conversations.count({ where: { store_id: other.storeId } }), 1);
    equal(await db.orders.count({ where: { store_id: other.storeId } }), 1);
    equal(await balanceOf(other.itemId), 9);
  });

  it('keeps a customer that a counter sale still uses', async () => {
    const { storeId, slug, coca } = await setup();
    const { customerId } = await seedConversation(db, storeId);
    const sale = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });

    await PosRepository.addLine(db, storeId, sale.id, { product: coca, qty: 1, selections: [] });
    await db.orders.updateOne({ data: { customer_id: customerId }, where: { id: sale.id } });

    const { body } = await reset(storeId, slug);

    equal(body.customers, 0);
    equal(await db.customers.count({ where: { id: customerId } }), 1);
  });

  it('refuses another slug as confirmation', async () => {
    const { storeId } = await setup();

    await seedConversation(db, storeId);

    await rejects(
      reset(storeId, 'wrong-slug'),
      (error) => error instanceof HttpBadRequestError && error.context?.field === 'slug'
    );
    equal(await db.conversations.count({ where: { store_id: storeId } }), 1);
  });

  it('answers 404 when the demo is off', async () => {
    const { storeId, slug } = await setup();

    process.env.DEMO_ENABLED = 'false';

    await rejects(reset(storeId, slug), HttpNotFoundError);
  });

  it('answers 404 for an unknown store', async () => {
    await rejects(reset(randomUUID(), 'x'), HttpNotFoundError);
  });
});
