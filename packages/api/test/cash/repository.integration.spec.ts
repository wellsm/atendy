import type { Db } from '../../src/db';

import { equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { CashError, CashErrorCode } from '../../src/cash/errors';
import { CashRepository } from '../../src/cash/repository';
import { CashMovementKind } from '../../src/cash/types';
import { OrderRepository } from '../../src/orders/repository';
import { OrderStatus } from '../../src/orders/types';
import { PaymentMethod } from '../../src/stores/types';
import { placeOrder, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('CashRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const isCashError = (code: CashErrorCode) => (error: unknown) => error instanceof CashError && error.code === code;

  const orderCash = async (storeId: string) => {
    const { records } = await db.cash_movements.findMany({
      select: { session_id: true, amount_cents: true, order_id: true },
      where: { store_id: storeId, kind: CashMovementKind.OrderCash }
    });

    return records;
  };

  it('opens one session per store', async () => {
    const { storeId } = await seedStore(db);

    const results = await Promise.allSettled([
      CashRepository.open(db, storeId, { floatCents: 1000, author: 'user_1' }),
      CashRepository.open(db, storeId, { floatCents: 2000, author: 'user_2' })
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');

    equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    equal(rejected.length, 1);
    ok(isCashError(CashErrorCode.SessionOpen)(rejected[0]!.reason));
  });

  it('claims order cash received while the drawer was closed, once the store used the drawer', async () => {
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Cash] });
    const menu = await seedMenu(db, storeId);

    const completeCashOrder = async () => {
      const { conversationId, customerId } = await seedConversation(db, storeId);
      const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu, PaymentMethod.Cash);

      for (const status of [OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done]) {
        await OrderRepository.setStatus(db, { storeId, orderId, status });
      }

      return (await db.orders.findOne({ select: { total_cents: true }, where: { id: orderId } }))!.total_cents;
    };

    // Never opened a session: nothing piles up for the first opening.
    await completeCashOrder();
    equal((await orderCash(storeId)).length, 0);

    const first = await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

    await CashRepository.close(db, storeId, first.id, { countedCents: 0, author: 'user_1' });

    const total = await completeCashOrder();

    equal((await orderCash(storeId))[0]!.session_id ?? null, null);

    const session = await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

    equal((await orderCash(storeId))[0]!.session_id, session.id);
    equal((await CashRepository.report(db, storeId, session.id)).orderCashCents, total);
    equal((await CashRepository.report(db, storeId, first.id)).orderCashCents, 0);
  });

  it('refuses refunds into a closed session', async () => {
    const { storeId } = await seedStore(db);
    const session = await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });
    const refund = (sessionId: string) =>
      db.transaction((tx) =>
        CashRepository.recordRefunds(tx, storeId, sessionId, [{ method: PaymentMethod.Cash, amountCents: 500 }], {
          orderId: randomUUID(),
          reason: 'Cliente desistiu',
          author: 'user_1'
        })
      );

    await refund(session.id);
    equal((await CashRepository.report(db, storeId, session.id)).refundsByMethod.cash, 500);

    await CashRepository.close(db, storeId, session.id, { countedCents: 0, author: 'user_1' });

    await rejects(refund(session.id), isCashError(CashErrorCode.NoSession));

    const { records } = await db.cash_movements.findMany({
      select: { id: true },
      where: { store_id: storeId, kind: CashMovementKind.Refund }
    });

    equal(records.length, 1);
  });

  it('records order cash when a WhatsApp cash order is done', async () => {
    const run = async (cashControl: boolean) => {
      const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Cash] });
      const menu = await seedMenu(db, storeId);
      const { conversationId, customerId } = await seedConversation(db, storeId);
      const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu, PaymentMethod.Cash);

      await db.stores.updateOne({ data: { pos_cash_control: cashControl }, where: { id: storeId } });
      await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

      for (const status of [OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done]) {
        await OrderRepository.setStatus(db, { storeId, orderId, status });
      }

      const order = await db.orders.findOne({ select: { total_cents: true }, where: { id: orderId } });

      return { rows: await orderCash(storeId), total: order!.total_cents, orderId };
    };

    const on = await run(true);

    equal(on.rows.length, 1);
    equal(on.rows[0]!.amount_cents, on.total);
    equal(on.rows[0]!.order_id, on.orderId);

    equal((await run(false)).rows.length, 0);
  });

  it('refuses a sangria without an open session', async () => {
    const { storeId } = await seedStore(db);
    const sangria = { kind: CashMovementKind.Sangria, amountCents: 500, author: 'user_1' } as const;

    await rejects(
      CashRepository.move(db, storeId, { ...sangria, reason: 'Troco' }),
      isCashError(CashErrorCode.NoSession)
    );

    await CashRepository.open(db, storeId, { floatCents: 1000, author: 'user_1' });

    await rejects(CashRepository.move(db, storeId, { ...sangria, reason: '  ' }), isCashError(CashErrorCode.Reason));

    const movement = await CashRepository.move(db, storeId, { ...sangria, reason: 'Depósito' });

    equal(movement.method, PaymentMethod.Cash);
    equal(movement.reason, 'Depósito');
  });

  it('keeps a closed session as it was', async () => {
    const { storeId } = await seedStore(db);
    const session = await CashRepository.open(db, storeId, { floatCents: 1000, author: 'user_1' });

    await CashRepository.move(db, storeId, {
      kind: CashMovementKind.Suprimento,
      amountCents: 500,
      reason: 'Troco',
      author: 'user_1'
    });

    const report = await CashRepository.close(db, storeId, session.id, { countedCents: 1400, author: 'user_1' });

    equal(report.expectedCashCents, 1500);
    equal(report.differenceCents, -100);

    await rejects(
      CashRepository.close(db, storeId, session.id, { countedCents: 1500, author: 'user_1' }),
      isCashError(CashErrorCode.AlreadyClosed)
    );

    const stored = await CashRepository.getSession(db, storeId, session.id);

    equal(stored.countedCents, 1400);
    equal(stored.expectedCents, 1500);
    equal(stored.closedBy, 'user_1');

    // Order cash after the close waits for the next session.
    await db.transaction((tx) =>
      CashRepository.recordOrderCash(tx, storeId, { orderId: randomUUID(), amountCents: 300, author: 'system' })
    );

    equal((await CashRepository.report(db, storeId, session.id)).orderCashCents, 0);
  });

  it('refuses another store session', async () => {
    const { storeId } = await seedStore(db);
    const other = await seedStore(db);
    const session = await CashRepository.open(db, storeId, { floatCents: 0, author: 'user_1' });

    await rejects(CashRepository.report(db, other.storeId, session.id), isCashError(CashErrorCode.NotFound));
    await rejects(
      CashRepository.close(db, other.storeId, session.id, { countedCents: 0, author: 'user_1' }),
      isCashError(CashErrorCode.NotFound)
    );
  });
});
