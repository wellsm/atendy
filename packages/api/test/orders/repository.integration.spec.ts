import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { PricingError, PricingErrorCode } from '../../src/orders/pricing';
import { CartMissing, OrderError, OrderErrorCode, OrderRepository } from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';
import {
  groupIdOf,
  hoursClosingIn,
  minutesAgo,
  optionIdOf,
  placeOrder,
  productByName,
  seedConversation,
  seedMenu,
  seedStore
} from '../support/fixtures';

describe('OrderRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (store: Parameters<typeof seedStore>[1] = {}) => {
    const { storeId } = await seedStore(db, {
      flat_fee_cents: 800,
      payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash],
      ...store
    });
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);

    return { scope: { storeId, conversationId, customerId }, menu };
  };

  const isOrderError = (code: OrderErrorCode) => (error: unknown) => error instanceof OrderError && error.code === code;

  const isPricingError = (code: PricingErrorCode) => (error: unknown) =>
    error instanceof PricingError && error.code === code;

  it('prices items in code and recomputes totals on every change', async () => {
    const { scope, menu } = await setup();
    const grande = productByName(menu, 'Pizza Grande');
    const coca = productByName(menu, 'Coca-Cola 2L');

    const halfAndHalf = await OrderRepository.addItem(db, scope, {
      product: grande,
      qty: 2,
      selections: [
        {
          group_id: groupIdOf(grande, 'Sabores'),
          option_ids: [optionIdOf(grande, 'Sabores', 'Calabresa'), optionIdOf(grande, 'Sabores', 'Portuguesa')]
        },
        { group_id: groupIdOf(grande, 'Borda'), option_ids: [optionIdOf(grande, 'Borda', 'Catupiry')] }
      ]
    });

    equal(halfAndHalf.items[0]!.unit_price_cents, 6290);
    equal(halfAndHalf.items[0]!.line_total_cents, 12580);
    equal(halfAndHalf.items[0]!.options, 'Sabores: Calabresa / Portuguesa; Borda: Catupiry');

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [], notes: 'bem gelada' });

    const delivered = await OrderRepository.setFulfillment(db, scope, Fulfillment.Delivery);

    equal(delivered.subtotal_cents, 13980);
    equal(delivered.fee_cents, 800);
    equal(delivered.total_cents, 14780);
    equal(delivered.items[1]!.notes, 'bem gelada');

    const stored = await db.orders.findOne({ select: { total_cents: true }, where: { id: delivered.order_id } });

    equal(stored?.total_cents, 14780);

    const picked = await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);

    equal(picked.fee_cents, 0);
    equal(picked.total_cents, 13980);
  });

  it('lists what is missing until the order can be placed', async () => {
    const { scope, menu } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    const first = await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    deepEqual(first.missing, [CartMissing.Fulfillment, CartMissing.Payment]);

    const delivery = await OrderRepository.setFulfillment(db, scope, Fulfillment.Delivery);

    deepEqual(delivery.missing, [CartMissing.Address, CartMissing.Payment]);

    await OrderRepository.setAddress(db, scope, { address: 'Rua A, 10', neighborhood: 'Centro' });

    const paid = await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    deepEqual(paid.missing, []);
  });

  it('charges the zone fee and flags a neighborhood that is not served', async () => {
    const { scope, menu } = await setup({ delivery_mode: DeliveryMode.ByZone });
    const coca = productByName(menu, 'Coca-Cola 2L');

    await db.delivery_zones.insertOne({
      data: { id: randomUUID(), store_id: scope.storeId, neighborhood: 'São José', fee_cents: 650 }
    });

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    const outside = await OrderRepository.setAddress(db, scope, { address: 'Rua B, 2', neighborhood: 'Vila Nova' });

    equal(outside.fulfillment, Fulfillment.Delivery);
    equal(outside.fee_cents, 0);
    equal(outside.missing.includes(CartMissing.DeliveryArea), true);

    const inside = await OrderRepository.setAddress(db, scope, { address: 'Rua B, 2', neighborhood: 'sao jose' });

    equal(inside.fee_cents, 650);
    equal(inside.missing.includes(CartMissing.DeliveryArea), false);
  });

  it('rejects a payment method the store does not accept and cash change below the total', async () => {
    const { scope, menu } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    await rejects(
      OrderRepository.setPayment(db, scope, { method: PaymentMethod.Card }),
      isOrderError(OrderErrorCode.PaymentNotAccepted)
    );

    await rejects(
      OrderRepository.setPayment(db, scope, { method: PaymentMethod.Cash, changeForCents: 1000 }),
      isPricingError(PricingErrorCode.ChangeBelowTotal)
    );

    const cash = await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Cash, changeForCents: 5000 });

    equal(cash.change_for_cents, 5000);

    const pix = await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix, changeForCents: 5000 });

    equal(pix.change_for_cents, null);
  });

  it('removes only items of the current draft', async () => {
    const { scope, menu } = await setup();
    const other = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    const mine = await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });
    const theirs = await OrderRepository.addItem(db, other.scope, {
      product: productByName(other.menu, 'Coca-Cola 2L'),
      qty: 1,
      selections: []
    });

    await rejects(
      OrderRepository.removeItem(db, scope, theirs.items[0]!.item_id),
      isOrderError(OrderErrorCode.ItemNotFound)
    );

    const emptied = await OrderRepository.removeItem(db, scope, mine.items[0]!.item_id);

    deepEqual(emptied.items, []);
    equal(emptied.total_cents, 0);
  });

  it('refuses to place an incomplete order, places a complete one and starts a new draft afterwards', async () => {
    const { scope, menu } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    await rejects(OrderRepository.place(db, scope), isOrderError(OrderErrorCode.NoDraft));

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    await rejects(OrderRepository.place(db, scope), isOrderError(OrderErrorCode.Incomplete));

    await OrderRepository.setAddress(db, scope, { address: 'Rua A, 10', neighborhood: 'Centro' });
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const placed = await OrderRepository.place(db, scope);

    equal(placed.status, OrderStatus.Placed);

    const order = await db.orders.findOne({
      select: { status: true, placed_at: true },
      where: { id: placed.order_id }
    });
    const customer = await db.customers.findOne({ select: { last_address: true }, where: { id: scope.customerId } });

    equal(order?.status, OrderStatus.Placed);
    equal(typeof order?.placed_at, 'string');
    equal(customer?.last_address, 'Rua A, 10');
    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);

    // While the store has not accepted it, the placed order stays the current one.
    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: placed.order_id } });

    const next = await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    equal(next.order_id === placed.order_id, false);
  });

  it('propagates pricing errors without creating items', async () => {
    const { scope, menu } = await setup();
    const grande = productByName(menu, 'Pizza Grande');

    await rejects(
      OrderRepository.addItem(db, scope, { product: grande, qty: 1, selections: [] }),
      isPricingError(PricingErrorCode.BelowMin)
    );

    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);
  });

  const isHandoff = (code: OrderErrorCode, reason: string) => (error: unknown) =>
    error instanceof OrderError && error.code === code && error.handoffReason === reason;

  it('adds to the placed order while the store has not accepted it, and confirms the changes', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);

    const cart = await OrderRepository.addItem(db, scope, {
      product: productByName(menu, 'Coca-Cola 2L'),
      qty: 1,
      selections: []
    });

    equal(cart.order_id, orderId);
    equal(cart.status, OrderStatus.Placed);
    equal(cart.subtotal_cents, 2800);
    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);

    const order = await db.orders.findOne({ select: { amended_at: true }, where: { id: orderId } });

    equal(typeof order?.amended_at, 'string');

    const confirmed = await OrderRepository.place(db, scope);

    equal(confirmed.order_id, orderId);
    equal(confirmed.status, OrderStatus.Placed);
  });

  it('resolves the current order: draft, then the placed order in the window, else nothing', async () => {
    const { scope, menu } = await setup();
    const coca = productByName(menu, 'Coca-Cola 2L');

    equal(await OrderRepository.findCurrentOrder(db, scope), undefined);

    const orderId = await placeOrder(db, scope, menu);

    deepEqual(await OrderRepository.findCurrentOrder(db, scope), { id: orderId, status: OrderStatus.Placed });

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    const draft = await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    equal(draft.status, OrderStatus.Draft);

    // A draft wins even if an older order is still placed.
    await db.orders.updateOne({ data: { status: OrderStatus.Placed }, where: { id: orderId } });

    deepEqual(await OrderRepository.findCurrentOrder(db, scope), { id: draft.order_id, status: OrderStatus.Draft });

    const other = await setup();
    const oldId = await placeOrder(db, other.scope, other.menu);

    // Default window: 3 hours.
    await db.orders.updateOne({ data: { placed_at: minutesAgo(4 * 60) }, where: { id: oldId } });

    equal(await OrderRepository.findCurrentOrder(db, other.scope), undefined);
  });

  it('refuses to write a placed order the store accepted meanwhile', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    let wrote = false;

    await rejects(
      OrderRepository.editPlacedOrder(db, orderId, () => {
        wrote = true;

        return Promise.resolve();
      }),
      isHandoff(OrderErrorCode.OrderLocked, 'order_already_accepted')
    );

    equal(wrote, false);
  });

  it('rolls back an edit of a placed order when the write fails', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);

    await rejects(
      OrderRepository.editPlacedOrder(db, orderId, async (tx) => {
        await tx.orders.updateOne({ data: { address: 'Rua X, 1' }, where: { id: orderId } });

        throw new Error('boom');
      }),
      /boom/
    );

    const order = await db.orders.findOne({ select: { address: true, amended_at: true }, where: { id: orderId } });

    equal(order?.address ?? null, null);
    equal(order?.amended_at ?? null, null);
  });

  it('sends the removal of the last item of a placed order to a human', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);
    const [item] = (await OrderRepository.getCart(db, orderId)).items;

    await rejects(
      OrderRepository.removeItem(db, scope, item!.item_id),
      isHandoff(OrderErrorCode.NeedsHuman, 'cancel_request')
    );

    equal((await OrderRepository.getCart(db, orderId)).items.length, 1);
  });

  it('does not rewrite the totals of an order the store accepted', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted, total_cents: 1 }, where: { id: orderId } });

    await OrderRepository.getCart(db, orderId);

    equal((await db.orders.findOne({ select: { total_cents: true }, where: { id: orderId } }))?.total_cents, 1);
  });

  it('refuses an item above the quantity or order limit before writing anything', async () => {
    const { scope, menu } = await setup({ policy: { max_item_qty: 5, max_order_cents: 5000 } });
    const coca = productByName(menu, 'Coca-Cola 2L');

    await rejects(
      OrderRepository.addItem(db, scope, { product: coca, qty: 6, selections: [] }),
      isHandoff(OrderErrorCode.NeedsHuman, 'qty_limit')
    );

    await rejects(
      OrderRepository.addItem(db, scope, { product: coca, qty: 4, selections: [] }),
      isHandoff(OrderErrorCode.NeedsHuman, 'order_limit')
    );

    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);

    const cart = await OrderRepository.addItem(db, scope, { product: coca, qty: 3, selections: [] });

    await rejects(
      OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] }),
      isHandoff(OrderErrorCode.NeedsHuman, 'order_limit')
    );

    equal((await OrderRepository.getCart(db, cart.order_id)).items.length, 1);
  });

  it('lists the minimum order as missing and refuses to place below it', async () => {
    const { scope, menu } = await setup({ policy: { min_order_cents: 3000 } });
    const coca = productByName(menu, 'Coca-Cola 2L');

    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);

    const below = await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    deepEqual(below.missing, [CartMissing.MinimumOrder]);
    await rejects(OrderRepository.place(db, scope), isOrderError(OrderErrorCode.Incomplete));

    const enough = await OrderRepository.addItem(db, scope, { product: coca, qty: 2, selections: [] });

    deepEqual(enough.missing, []);
  });

  it('refuses cash change above the store limit', async () => {
    const { scope, menu } = await setup({ policy: { max_change_cents: 5000 } });

    await OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);

    await rejects(
      OrderRepository.setPayment(db, scope, { method: PaymentMethod.Cash, changeForCents: 10000 }),
      isOrderError(OrderErrorCode.ChangeTooHigh)
    );

    const cart = await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Cash, changeForCents: 5000 });

    equal(cart.change_for_cents, 5000);
  });

  it('flags only the first large order of a new customer for review', async () => {
    const { scope, menu } = await setup({ policy: { new_customer_review_cents: 2000 } });
    const coca = productByName(menu, 'Coca-Cola 2L');

    await OrderRepository.addItem(db, scope, { product: coca, qty: 2, selections: [] });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const first = await OrderRepository.place(db, scope);

    equal(first.review, true);

    // Confirming a change to the same order does not ask again.
    await OrderRepository.addItem(db, scope, { product: coca, qty: 1, selections: [] });

    equal((await OrderRepository.place(db, scope)).review, false);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: first.order_id } });

    await OrderRepository.addItem(db, scope, { product: coca, qty: 2, selections: [] });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const second = await OrderRepository.place(db, scope);

    equal(second.order_id === first.order_id, false);
    equal(second.review, false);
  });

  it('stops placing orders in the last minutes before closing', async () => {
    const policy = { last_order_minutes: 30 };
    const closing = await setup({ timezone: 'UTC', hours: hoursClosingIn(10), policy });
    const open = await setup({ timezone: 'UTC', hours: hoursClosingIn(120), policy });

    for (const { scope, menu } of [closing, open]) {
      await OrderRepository.addItem(db, scope, {
        product: productByName(menu, 'Coca-Cola 2L'),
        qty: 1,
        selections: []
      });
      await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
      await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });
    }

    await rejects(OrderRepository.place(db, closing.scope), isOrderError(OrderErrorCode.StoreClosing));
    equal((await OrderRepository.place(db, open.scope)).status, OrderStatus.Placed);
  });

  it('stores the new totals in the same transaction as the edit', async () => {
    const { scope, menu } = await setup();
    const orderId = await placeOrder(db, scope, menu);
    const coca = productByName(menu, 'Coca-Cola 2L');

    await OrderRepository.editPlacedOrder(db, orderId, async (tx) => {
      await tx.order_items.insertOne({
        data: {
          id: randomUUID(),
          store_id: scope.storeId,
          order_id: orderId,
          product_id: coca.id,
          product_name: coca.name,
          qty: 1,
          unit_price_cents: 1400,
          options_snapshot: [],
          notes: null,
          created_at: new Date().toISOString()
        }
      });
    });

    // No getCart afterwards: a store accepting right after the commit must already see these totals.
    equal((await db.orders.findOne({ select: { total_cents: true }, where: { id: orderId } }))?.total_cents, 2800);
  });
});
