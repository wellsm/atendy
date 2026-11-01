import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { CashRepository } from '../../src/cash/repository';
import { OrderStatus } from '../../src/orders/types';
import { Fulfillment } from '../../src/orders/types';
import { assignCourierHandler } from '../../src/panel/endpoints/assign-courier';
import { updateOrderHandler } from '../../src/panel/endpoints/update-order';
import { courierFeeCents, courierMessageText } from '../../src/staff/couriers';
import { getCourierPageHandler } from '../../src/staff/endpoints/get-courier-page';
import { markDeliveredHandler } from '../../src/staff/endpoints/mark-delivered';
import { StaffRepository } from '../../src/staff/repository';
import { StaffRole } from '../../src/staff/types';
import { StoreRepository } from '../../src/stores/repository';
import { PaymentMethod } from '../../src/stores/types';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { placeOrder, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('couriers: dispatch, message and page', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  afterEach(() => mock.restoreAll());

  let counter = 0;

  const stubProvider = () => {
    const sent: { to: string; text: string }[] = [];

    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: (input: { to: string; text: string }) => {
        // The customer's status message goes through the same provider: keep only the courier dispatches.
        if (input.text.startsWith('🛵 Nova entrega')) {
          sent.push(input);
        }

        return Promise.resolve({ providerMessageId: `COURIER-${++counter}` });
      }
    }));

    return sent;
  };

  const newCourier = async (storeId: string, name = 'Zé') => {
    const member = await StaffRepository.create(db, storeId, {
      name,
      role: StaffRole.Courier,
      delivers: true,
      phone: '11 97777-6666'
    });

    const token = await StaffRepository.regenerateCourierToken(db, storeId, member.id);

    return { ...member, token };
  };

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash] });

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu, PaymentMethod.Cash);

    await db.customers.updateOne({ data: { name: 'Maria' }, where: { id: customerId } });

    return { storeId, menu, orderId, conversationId, customerId, identity: { userId: 'user_1', orgId } };
  };

  /**
   * The seeded pickup order becomes a delivery order that the store already accepted.
   */
  const asDelivery = (orderId: string, status = OrderStatus.Accepted) =>
    db.orders.updateOne({
      data: { fulfillment: Fulfillment.Delivery, address: 'Rua A, 10', neighborhood: 'Centro', fee_cents: 700, status },
      where: { id: orderId }
    });

  const dispatch = (identity: object, orderId: string, courierId?: string) =>
    updateOrderHandler(
      { identity, parameters: { orderId }, body: { status: OrderStatus.Out, courier_id: courierId } } as never,
      { db, panelEvents }
    );

  const orderRow = (orderId: string) =>
    db.orders.findOne({
      select: {
        status: true,
        courier_id: true,
        courier_fee_cents: true,
        dispatched_at: true,
        delivered_at: true,
        delivered_lat: true,
        delivered_lng: true
      },
      where: { id: orderId }
    });

  const page = (token: string) => getCourierPageHandler({ parameters: { token } } as never, { db, panelEvents });

  const delivered = (token: string, orderId: string, body: object = {}) =>
    markDeliveredHandler({ parameters: { token, orderId }, body } as never, { db, panelEvents });

  it('computes the courier fee and the message text', () => {
    equal(courierFeeCents({ courierFeeMode: 'order_fee', courierFeeCents: 500 }, { feeCents: 700 }), 700);
    equal(courierFeeCents({ courierFeeMode: 'fixed', courierFeeCents: 500 }, { feeCents: 700 }), 500);
    equal(
      courierMessageText({ code: 'K7Q2MX', place: 'Centro', webBaseUrl: 'http://web.test/', token: 'tok' }),
      '🛵 Nova entrega #K7Q2MX\n📍 Centro\n\nSuas entregas: http://web.test/courier/tok'
    );
  });

  it('dispatches with a courier: freezes the order fee, messages the courier and writes the echo row', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);
    const sent = stubProvider();

    await asDelivery(orderId);

    const response = await dispatch(identity, orderId, courier.id);
    const row = await orderRow(orderId);

    equal(row?.status, OrderStatus.Out);
    equal(row?.courier_id, courier.id);
    equal(row?.courier_fee_cents, 700);
    ok(row?.dispatched_at);
    deepEqual(response.body.order.courier, { id: courier.id, name: 'Zé' });

    const text = `🛵 Nova entrega #${response.body.order.code}\n📍 Centro\n\nSuas entregas: http://web.test/courier/${courier.token}`;

    deepEqual(sent, [{ to: courier.phone, text }]);

    const { records } = await db.courier_messages.findMany({
      select: { phone: true, body: true, provider_message_id: true },
      where: { store_id: storeId }
    });

    deepEqual(records, [{ phone: courier.phone, body: text, provider_message_id: 'COURIER-' + counter }]);
  });

  it('freezes the fixed fee when the store pays a fixed amount', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);

    stubProvider();
    await db.stores.updateOne({ data: { courier_fee_mode: 'fixed', courier_fee_cents: 500 }, where: { id: storeId } });
    await asDelivery(orderId);
    await dispatch(identity, orderId, courier.id);

    equal((await orderRow(orderId))?.courier_fee_cents, 500);
  });

  it('dispatches without a courier sending nothing, and refuses a courier on pickup or an inactive one', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);
    const sent = stubProvider();

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    // Pickup order with a courier: 400 on `courier_id`.
    await rejects(
      dispatch(identity, orderId, courier.id),
      (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'courier_id'
    );

    equal((await orderRow(orderId))?.status, OrderStatus.Accepted);

    await asDelivery(orderId);
    await db.staff.updateOne({ data: { active: false }, where: { id: courier.id } });
    await rejects(dispatch(identity, orderId, courier.id), HttpBadRequestError);

    await dispatch(identity, orderId);

    const row = await orderRow(orderId);

    equal(row?.status, OrderStatus.Out);
    equal(row?.courier_id ?? null, null);
    deepEqual(sent, []);
    equal(await db.courier_messages.count({ where: { store_id: storeId } }), 0);
  });

  it('changes the courier while out: re-freezes the fee and messages the new courier', async () => {
    const { storeId, orderId, identity } = await setup();
    const first = await newCourier(storeId, 'Zé');
    const second = await newCourier(storeId, 'Beto');
    const sent = stubProvider();

    await asDelivery(orderId);
    await dispatch(identity, orderId, first.id);
    await db.stores.updateOne({ data: { courier_fee_mode: 'fixed', courier_fee_cents: 450 }, where: { id: storeId } });

    const response = await assignCourierHandler(
      { identity, parameters: { orderId }, body: { courier_id: second.id } } as never,
      { db, panelEvents }
    );

    equal(response.body.order.courier?.name, 'Beto');
    equal((await orderRow(orderId))?.courier_fee_cents, 450);
    equal(sent.length, 2);
    ok(sent[1]!.text.endsWith(`/courier/${second.token}`));

    // Only while out.
    await db.orders.updateOne({ data: { status: OrderStatus.Done }, where: { id: orderId } });
    await rejects(
      assignCourierHandler({ identity, parameters: { orderId }, body: { courier_id: first.id } } as never, {
        db,
        panelEvents
      }),
      (error: unknown) => error instanceof HttpConflictError
    );
  });

  it('recomputes the fee of deliveries still out when the fee setting changes', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);

    stubProvider();
    await asDelivery(orderId);
    await dispatch(identity, orderId, courier.id);
    equal((await orderRow(orderId))?.courier_fee_cents, 700);

    const settings = await StoreRepository.getStaffSettings(db, storeId);

    await StoreRepository.setStaffSettings(db, storeId, { ...settings, courierFeeMode: 'fixed', courierFeeCents: 520 });
    equal((await orderRow(orderId))?.courier_fee_cents, 520);

    await StoreRepository.setStaffSettings(db, storeId, { ...settings, courierFeeMode: 'order_fee' });
    equal((await orderRow(orderId))?.courier_fee_cents, 700);
  });

  it('refuses a courier with a status other than out, and sends nothing for an inactive store', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);
    const sent = stubProvider();

    await asDelivery(orderId);
    await rejects(
      updateOrderHandler(
        { identity, parameters: { orderId }, body: { status: OrderStatus.Canceled, courier_id: courier.id } } as never,
        { db, panelEvents }
      ),
      (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'courier_id'
    );

    await db.stores.updateOne({ data: { active: false }, where: { id: storeId } });
    await dispatch(identity, orderId, courier.id);

    deepEqual(sent, []);
    equal(await db.courier_messages.count({ where: { store_id: storeId } }), 0);
  });

  it('stamps delivered_at when the board concludes an order that has a courier, and shows notes to the courier', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);

    stubProvider();
    await asDelivery(orderId);
    await db.orders.updateOne({ data: { notes: 'Portão azul' }, where: { id: orderId } });
    await dispatch(identity, orderId, courier.id);

    equal((await page(courier.token)).body.open[0]!.notes, 'Portão azul');

    await updateOrderHandler({ identity, parameters: { orderId }, body: { status: OrderStatus.Done } } as never, {
      db,
      panelEvents
    });

    const row = await orderRow(orderId);

    equal(row?.status, OrderStatus.Done);
    ok(row?.delivered_at);
  });

  it('shows the courier only their own out orders, then marks one delivered with position and order cash', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);
    const other = await newCourier(storeId, 'Beto');

    stubProvider();
    await asDelivery(orderId);
    await db.orders.updateOne({ data: { change_for_cents: 10000 }, where: { id: orderId } });
    await CashRepository.open(db, storeId, { floatCents: 1000, author: 'user_1' });
    await dispatch(identity, orderId, courier.id);

    const mine = (await page(courier.token)).body;
    const theirs = (await page(other.token)).body;

    equal(mine.courierName, 'Zé');
    equal(mine.open.length, 1);
    equal(mine.open[0]!.customerName, 'Maria');
    ok(mine.open[0]!.customerPhone);
    equal(mine.open[0]!.address, 'Rua A, 10');
    equal(mine.open[0]!.paymentMethod, PaymentMethod.Cash);
    equal(mine.open[0]!.changeForCents, 10000);
    deepEqual(theirs.open, []);

    // Another courier's order is a 404 and stays out.
    await rejects(delivered(other.token, orderId), HttpNotFoundError);
    equal((await orderRow(orderId))?.status, OrderStatus.Out);

    await delivered(courier.token, orderId, { lat: -23.5, lng: -46.6 });

    const row = await orderRow(orderId);

    equal(row?.status, OrderStatus.Done);
    ok(row?.delivered_at);
    equal(row?.delivered_lat, -23.5);
    equal(row?.delivered_lng, -46.6);

    const cash = await db.cash_movements.findMany({
      select: { author: true, kind: true },
      where: { order_id: orderId }
    });

    deepEqual(cash.records, [{ author: courier.id, kind: 'order_cash' }]);
    deepEqual(panelEvents.sendMessage.mock.calls.at(-1)?.arguments[0], {
      storeId,
      triggers: ['orders', 'conversations'],
      conversationId: (await db.orders.findOne({ select: { conversation_id: true }, where: { id: orderId } }))
        ?.conversation_id
    });

    // Delivered rows carry no customer data.
    const after = (await page(courier.token)).body;

    deepEqual(after.open, []);
    equal(after.deliveredToday.length, 1);
    deepEqual(Object.keys(after.deliveredToday[0]!).sort(), ['code', 'deliveredAt', 'feeCents']);
    equal(after.deliveredToday[0]!.feeCents, 700);

    // Again: no longer out.
    await rejects(delivered(courier.token, orderId), HttpNotFoundError);
  });

  it('refuses "Entreguei" from a courier whose order was reassigned after the page loaded', async () => {
    const { storeId, orderId, identity } = await setup();
    const first = await newCourier(storeId, 'Zé');
    const second = await newCourier(storeId, 'Beto');

    stubProvider();
    await asDelivery(orderId);
    await dispatch(identity, orderId, first.id);

    equal((await page(first.token)).body.open.length, 1);

    await assignCourierHandler({ identity, parameters: { orderId }, body: { courier_id: second.id } } as never, {
      db,
      panelEvents
    });

    await rejects(delivered(first.token, orderId), HttpNotFoundError);
    equal((await orderRow(orderId))?.status, OrderStatus.Out);

    await delivered(second.token, orderId);
    equal((await orderRow(orderId))?.status, OrderStatus.Done);
  });

  it('gives a courier without a link one token even for parallel dispatches', async () => {
    const { storeId, menu, orderId, identity } = await setup();
    const secondId = await placeOrder(
      db,
      { storeId, ...(await seedConversation(db, storeId)) },
      menu,
      PaymentMethod.Cash
    );
    const sent = stubProvider();

    const courier = await StaffRepository.create(db, storeId, {
      name: 'Zé',
      role: StaffRole.Courier,
      delivers: true,
      phone: '11 97777-6666'
    });

    await asDelivery(orderId);
    await asDelivery(secondId);
    await Promise.all([dispatch(identity, orderId, courier.id), dispatch(identity, secondId, courier.id)]);

    const row = await db.staff.findOne({ select: { courier_token: true }, where: { id: courier.id } });

    equal(sent.length, 2);
    ok(row?.courier_token);
    ok(sent.every((message) => message.text.endsWith(`/courier/${row.courier_token}`)));
  });

  it('delivers without a position, and treats regenerated or deactivated links as 404', async () => {
    const { storeId, orderId, identity } = await setup();
    const courier = await newCourier(storeId);

    stubProvider();
    await asDelivery(orderId);
    await dispatch(identity, orderId, courier.id);

    await rejects(delivered(courier.token, orderId, { lat: 95, lng: 0 }), HttpBadRequestError);
    await delivered(courier.token, orderId);

    const row = await orderRow(orderId);

    equal(row?.status, OrderStatus.Done);
    ok(row?.delivered_at);
    equal(row?.delivered_lat ?? null, null);

    const fresh = await StaffRepository.regenerateCourierToken(db, storeId, courier.id);

    await rejects(page(courier.token), HttpNotFoundError);
    equal((await page(fresh)).body.courierName, 'Zé');

    await db.staff.updateOne({ data: { active: false }, where: { id: courier.id } });
    await rejects(page(fresh), HttpNotFoundError);
  });
});
