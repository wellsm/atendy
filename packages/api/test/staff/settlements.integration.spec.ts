import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { CashRepository } from '../../src/cash/repository';
import { CashMovementKind } from '../../src/cash/types';
import { OrderStatus } from '../../src/orders/types';
import { getCourierPendingHandler } from '../../src/staff/endpoints/get-courier-pending';
import { listCourierSettlementsHandler } from '../../src/staff/endpoints/list-courier-settlements';
import { settleCourierHandler } from '../../src/staff/endpoints/settle-courier';
import { StaffRepository } from '../../src/staff/repository';
import { StaffRole } from '../../src/staff/types';
import { StoreRepository } from '../../src/stores/repository';
import { PaymentMethod } from '../../src/stores/types';
import { placeOrder, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('courier settlement', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (cashControl = true) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash] });

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });
    await StoreRepository.setPosSettings(db, storeId, {
      ...(await StoreRepository.getPosSettings(db, storeId)),
      cashControl
    });

    const menu = await seedMenu(db, storeId);
    const courier = await StaffRepository.create(db, storeId, {
      name: 'Zé',
      role: StaffRole.Courier,
      delivers: true,
      phone: '11 97777-6666'
    });

    const identity = { userId: 'user_1', orgId };
    const params = { staffId: courier.id };

    // A done delivery of the courier: R$ 5,00 fee, paid in cash or pix.
    const delivered = async (status = OrderStatus.Done, method = PaymentMethod.Cash) => {
      const { conversationId, customerId } = await seedConversation(db, storeId);
      const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu, method);

      await db.orders.updateOne({
        data: {
          status,
          courier_id: courier.id,
          courier_fee_cents: 500,
          delivered_at: new Date().toISOString()
        },
        where: { id: orderId }
      });

      return orderId;
    };

    const pending = (query: { from?: string; to?: string } = {}) =>
      getCourierPendingHandler({ identity, parameters: params, query, headers: {} } as never, { db });

    const settle = (orderIds: string[]) =>
      settleCourierHandler({ identity, parameters: params, body: { orderIds }, headers: {} } as never, { db });

    return { storeId, identity, params, delivered, pending, settle, courier };
  };

  it('lists only done, unsettled orders of the courier, with fee and cash', async () => {
    const { delivered, pending, settle } = await setup();

    const cash = await delivered();
    const pix = await delivered(OrderStatus.Done, PaymentMethod.Pix);
    await delivered(OrderStatus.Canceled);
    await delivered(OrderStatus.Out);

    const first = await pending();

    deepEqual(first.body.orders.map(({ id }) => id).sort(), [cash, pix].sort());
    equal(first.body.feesCents, 1000);
    ok(first.body.cashCents > 0);
    equal(first.body.netCents, first.body.cashCents - 1000);

    await settle([cash]);

    deepEqual(
      (await pending()).body.orders.map(({ id }) => id),
      [pix]
    );
  });

  it('settles once: a second settle of the same ids is a 409 settled', async () => {
    const { delivered, settle } = await setup();
    const orderId = await delivered();

    const first = await settle([orderId]);

    equal(first.body.settlement.feesCents, 500);
    equal(first.body.settlement.ordersCount, 1);

    await rejects(
      () => settle([orderId]),
      (error: unknown) => error instanceof HttpConflictError && error.context?.field === 'settled'
    );
  });

  it('pays the fees once when two settles race', async () => {
    const { storeId, delivered, settle, courier } = await setup();

    await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

    const orderId = await delivered();

    const results = await Promise.allSettled([settle([orderId]), settle([orderId])]);
    const losers = results.filter((result) => result.status === 'rejected');

    equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    equal(losers.length, 1);
    ok(losers[0]!.reason instanceof HttpConflictError && losers[0]!.reason.context?.field === 'settled');

    const settlements = await db.courier_settlements.findMany({
      select: { id: true },
      where: { store_id: storeId, courier_id: courier.id }
    });

    const payouts = await db.cash_movements.findMany({
      select: { id: true },
      where: { store_id: storeId, kind: CashMovementKind.CourierPayout }
    });

    equal(settlements.records.length, 1);
    ok(payouts.records.length <= 1);
  });

  it('refuses an empty settle or another courier`s order with a 400 order_ids', async () => {
    const { storeId, delivered, settle } = await setup();

    const badIds = (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'order_ids';

    await rejects(() => settle([]), badIds);

    const second = await StaffRepository.create(db, storeId, {
      name: 'Beto',
      role: StaffRole.Courier,
      delivers: true,
      phone: '11 96666-5555'
    });

    const theirs = await delivered();

    await db.orders.updateOne({ data: { courier_id: second.id }, where: { id: theirs } });
    await rejects(() => settle([theirs]), badIds);
  });

  it('records a courier payout in the open session and lowers the expected cash', async () => {
    const { storeId, delivered, settle } = await setup();

    const session = await CashRepository.open(db, storeId, { floatCents: 10000, author: 'user_1' });
    const before = (await CashRepository.report(db, storeId, session.id)).expectedCashCents;

    const { body } = await settle([await delivered(), await delivered()]);

    ok(body.settlement.cashMovementId);

    const { records } = await db.cash_movements.findMany({
      select: { amount_cents: true, session_id: true },
      where: { store_id: storeId, kind: CashMovementKind.CourierPayout }
    });

    equal(records.length, 1);
    equal(records[0]!.amount_cents, 1000);
    equal(records[0]!.session_id, session.id);
    equal((await CashRepository.report(db, storeId, session.id)).expectedCashCents, before - 1000);
  });

  it('settles with no movement when no session is open or cash control is off', async () => {
    const closed = await setup();
    const noSession = await closed.settle([await closed.delivered()]);

    equal(noSession.body.settlement.cashMovementId, null);

    const off = await setup(false);

    await CashRepository.open(db, off.storeId, { floatCents: 0, author: 'user_1' });

    const noControl = await off.settle([await off.delivered()]);

    equal(noControl.body.settlement.cashMovementId, null);
  });

  it('lists past settlements', async () => {
    const { identity, params, delivered, settle } = await setup();

    await settle([await delivered()]);

    const { body } = await listCourierSettlementsHandler({ identity, parameters: params, headers: {} } as never, {
      db
    });

    equal(body.settlements.length, 1);
    equal(body.settlements[0]!.feesCents, 500);
  });
});
