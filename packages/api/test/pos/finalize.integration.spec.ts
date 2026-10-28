import type { Db } from '../../src/db';
import type { PosPaymentInput } from '../../src/pos/types';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import { HttpBadRequestError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { CashRepository } from '../../src/cash/repository';
import { CashMovementKind } from '../../src/cash/types';
import { OrderStatus } from '../../src/orders/types';
import { cancelPosSaleHandler } from '../../src/pos/endpoints/cancel-sale';
import { finalizePosSaleHandler } from '../../src/pos/endpoints/finalize-sale';
import { listPosSalesHandler } from '../../src/pos/endpoints/list-sales';
import { PosRepository } from '../../src/pos/repository';
import { PosSaleList } from '../../src/pos/types';
import { StockRepository } from '../../src/stock/repository';
import { StockMovementKind, StockUnit } from '../../src/stock/types';
import { PaymentMethod } from '../../src/stores/types';
import { groupIdOf, optionIdOf, productByName, seedMenu, seedStore } from '../support/fixtures';

describe('pos finalize and cancel', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  // Ez4 restores client mocks after each test: take a fresh one per test.
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  const setup = async (options: { open?: boolean } = {}) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash] });
    const menu = await seedMenu(db, storeId);
    const coca = productByName(menu, 'Coca-Cola 2L');

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca 2L',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: item.id, qty: 1 }]);
    await StockRepository.recordEntry(db, storeId, { itemId: item.id, qty: 5, author: 'test' });

    const session =
      options.open === false ? null : await CashRepository.open(db, storeId, { floatCents: 10000, author: 'user_1' });

    return { storeId, menu, coca, itemId: item.id, session, identity: { userId: 'user_1', orgId } };
  };

  const cocaSale = async (storeId: string, coca: ReturnType<typeof productByName>, qty = 1) => {
    const { id } = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });

    return PosRepository.addLine(db, storeId, id, { product: coca, qty, selections: [] });
  };

  const balanceOf = async (itemId: string) =>
    (await db.stock_items.findOne({ select: { balance: true }, where: { id: itemId } }))?.balance;

  const saleMovements = (orderId: string) =>
    db.stock_movements.count({ where: { order_id: orderId, kind: StockMovementKind.Sale } });

  const finalize = async (identity: { userId: string; orgId: string }, saleId: string, payments: PosPaymentInput[]) =>
    (
      await finalizePosSaleHandler({ identity, parameters: { saleId }, body: { payments } } as never, {
        db,
        panelEvents
      })
    ).body.sale;

  const withField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('finalizes a drinks sale as done and moves stock', async () => {
    const { storeId, coca, itemId, session, identity } = await setup();
    const { id } = await cocaSale(storeId, coca);

    const sale = await finalize(identity, id, [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }]);

    equal(sale.status, OrderStatus.Done);
    ok(sale.code);
    ok(sale.placedAt);
    equal(sale.payments.length, 1);
    equal(await balanceOf(itemId), 4);
    equal(await db.order_payments.count({ where: { order_id: id } }), 1);

    const order = await db.orders.findOne({ select: { cash_session_id: true, created_by: true }, where: { id } });

    deepEqual(order, { cash_session_id: session!.id, created_by: 'user_1' });
    equal(panelEvents.sendMessage.mock.callCount(), 1);
  });

  it('sends a sale with a prepared item to the board', async () => {
    const { storeId, menu, identity } = await setup();
    const pizza = productByName(menu, 'Pizza Grande');
    const product = await db.products.findOne({ select: { category_id: true }, where: { id: pizza.id } });

    await db.categories.updateOne({ data: { needs_preparation: true }, where: { id: product!.category_id } });

    const { id } = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });

    const draft = await PosRepository.addLine(db, storeId, id, {
      product: pizza,
      qty: 1,
      selections: [{ group_id: groupIdOf(pizza, 'Sabores'), option_ids: [optionIdOf(pizza, 'Sabores', 'Calabresa')] }]
    });

    const sale = await finalize(identity, id, [{ method: PaymentMethod.Pix, amountCents: draft.totalCents }]);

    equal(sale.status, OrderStatus.Accepted);
    equal(panelEvents.sendMessage.mock.callCount(), 1);
    deepEqual(panelEvents.sendMessage.mock.calls[0]?.arguments, [{ storeId, triggers: ['orders'] }]);
  });

  it('finalizes once under parallel calls', async () => {
    const { storeId, coca, identity } = await setup();
    const { id } = await cocaSale(storeId, coca);
    const payments = [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }];

    const [first, second] = await Promise.all([finalize(identity, id, payments), finalize(identity, id, payments)]);

    ok(first.code);
    equal(first.code, second.code);
    equal(await saleMovements(id), 1);
    equal(await db.order_payments.count({ where: { order_id: id } }), 1);
  });

  it('refuses payments that do not cover the total', async () => {
    const { storeId, coca, itemId, identity } = await setup();
    const { id } = await cocaSale(storeId, coca);

    await rejects(
      finalize(identity, id, [{ method: PaymentMethod.Pix, amountCents: coca.price_cents - 1 }]),
      withField('payments')
    );

    equal((await PosRepository.getSale(db, storeId, id)).status, OrderStatus.Draft);
    equal(await balanceOf(itemId), 5);

    const empty = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'user_1' });

    await rejects(finalize(identity, empty.id, []), withField('no_lines'));
  });

  it('needs an open caixa while cash control is on', async () => {
    const { storeId, coca, identity } = await setup({ open: false });
    const { id } = await cocaSale(storeId, coca);
    const payments = [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }];

    await rejects(finalize(identity, id, payments), withField('cash_closed'));

    await db.stores.updateOne({ data: { pos_cash_control: false }, where: { id: storeId } });

    const sale = await finalize(identity, id, payments);

    equal(sale.status, OrderStatus.Done);
    equal((await db.orders.findOne({ select: { cash_session_id: true }, where: { id } }))?.cash_session_id, null);
  });

  it('never attaches a sale or refund to an open session while cash control is off', async () => {
    const { storeId, coca, session, identity } = await setup();
    const { id } = await cocaSale(storeId, coca);

    await db.stores.updateOne({ data: { pos_cash_control: false }, where: { id: storeId } });

    await finalize(identity, id, [{ method: PaymentMethod.Cash, amountCents: coca.price_cents }]);
    await PosRepository.cancel(db, storeId, id, { reason: 'Teste', author: 'user_1' });

    equal((await db.orders.findOne({ select: { cash_session_id: true }, where: { id } }))?.cash_session_id, null);

    const refunds = await db.cash_movements.findMany({ select: { session_id: true }, where: { order_id: id } });

    deepEqual(refunds.records, [{ session_id: null }]);
    equal((await CashRepository.report(db, storeId, session!.id)).expectedCashCents, 10000);
  });

  it('cancels a paid sale back into stock and refunds by method', async () => {
    const { storeId, coca, itemId, session, identity } = await setup();
    const draft = await cocaSale(storeId, coca, 2);

    // 2 × 14,00 + 2,00 = 50,00
    await PosRepository.updateSale(db, storeId, draft.id, { surchargeCents: 5000 - coca.price_cents * 2 });

    await finalize(identity, draft.id, [
      { method: PaymentMethod.Cash, amountCents: 3000, receivedCents: 5000 },
      { method: PaymentMethod.Pix, amountCents: 2000 }
    ]);

    equal(await balanceOf(itemId), 3);

    await CashRepository.close(db, storeId, session!.id, { countedCents: 13000, author: 'user_1' });

    const closedReport = await CashRepository.report(db, storeId, session!.id);

    const cancel = (reason: string) =>
      cancelPosSaleHandler({ identity, parameters: { saleId: draft.id }, body: { reason } } as never, {
        db,
        panelEvents
      });

    await rejects(cancel('Cliente desistiu'), withField('cash_closed'));
    await rejects(cancel('  '), withField('reason'));

    const next = await CashRepository.open(db, storeId, { floatCents: 5000, author: 'user_1' });
    const { sale } = (await cancel('Cliente desistiu')).body;

    equal(sale.status, OrderStatus.Canceled);
    equal(await balanceOf(itemId), 5);

    const { records: refunds } = await db.cash_movements.findMany({
      select: { session_id: true, method: true, amount_cents: true },
      where: { order_id: draft.id, kind: CashMovementKind.Refund }
    });

    deepEqual(
      refunds.sort((a, b) => a.method.localeCompare(b.method)),
      [
        { session_id: next.id, method: PaymentMethod.Cash, amount_cents: 3000 },
        { session_id: next.id, method: PaymentMethod.Pix, amount_cents: 2000 }
      ]
    );

    equal((await CashRepository.report(db, storeId, next.id)).expectedCashCents, 5000 - 3000);
    deepEqual(await CashRepository.report(db, storeId, session!.id), closedReport);
    equal(closedReport.salesCount, 1);
    equal(panelEvents.sendMessage.mock.callCount(), 2);
  });

  it('shows a cancel inside the same open session as canceled with its refunds', async () => {
    const { storeId, coca, session, identity } = await setup();
    const { id } = await cocaSale(storeId, coca);

    await finalize(identity, id, [{ method: PaymentMethod.Cash, amountCents: 1400, receivedCents: 2000 }]);
    await PosRepository.cancel(db, storeId, id, { reason: 'Errado', author: 'user_1' });

    const report = await CashRepository.report(db, storeId, session!.id);

    equal(report.salesCount, 0);
    equal(report.canceledCount, 1);
    equal(report.salesCents, 0);
    equal(report.byMethod.cash, 1400);
    equal(report.refundsByMethod.cash, 1400);
    equal(report.expectedCashCents, 10000);
  });

  it('reports POS payments in the session', async () => {
    const { storeId, coca, session, identity } = await setup();
    const first = await cocaSale(storeId, coca);
    const second = await cocaSale(storeId, coca, 2);

    await PosRepository.updateSale(db, storeId, second.id, { discount: { kind: 'value', value: 800 } });

    await finalize(identity, first.id, [{ method: PaymentMethod.Cash, amountCents: 1400, receivedCents: 2000 }]);
    await finalize(identity, second.id, [
      { method: PaymentMethod.Pix, amountCents: 1000 },
      { method: PaymentMethod.Cash, amountCents: 1000 }
    ]);

    const report = await CashRepository.report(db, storeId, session!.id);

    equal(report.salesCount, 2);
    equal(report.canceledCount, 0);
    equal(report.salesCents, 3400);
    equal(report.discountsCents, 800);
    deepEqual(report.byMethod, { pix: 1000, card: 0, cash: 2400, voucher: 0 });
    equal(report.expectedCashCents, 10000 + 2400);
  });
  it('lists the finalized sales of the open session, or of today without cash control', async () => {
    const { storeId, coca, session, identity } = await setup();
    const first = await cocaSale(storeId, coca);
    const second = await cocaSale(storeId, coca);
    const held = await cocaSale(storeId, coca);
    const pix = [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }];

    await finalize(identity, first.id, pix);
    await finalize(identity, second.id, pix);
    await PosRepository.cancel(db, storeId, second.id, { reason: 'Errado', author: 'user_1' });

    const list = async (status: PosSaleList) =>
      (await listPosSalesHandler({ identity, query: { status } } as never, { db })).body.sales;

    const finalized = await list(PosSaleList.Finalized);
    const byId = (id: string) => finalized.find((sale) => sale.id === id);

    equal(finalized.length, 2);
    ok(finalized.every(({ code, placedAt }) => code && placedAt));
    equal(byId(first.id)?.status, OrderStatus.Done);
    equal(byId(first.id)?.canceledAt, null);
    equal(byId(second.id)?.status, OrderStatus.Canceled);
    ok(byId(second.id)?.canceledAt);
    deepEqual(
      (await list(PosSaleList.Held)).map(({ id }) => id),
      [held.id]
    );

    await CashRepository.close(db, storeId, session!.id, { countedCents: 10000, author: 'user_1' });

    equal((await list(PosSaleList.Finalized)).length, 0);

    await db.stores.updateOne({ data: { pos_cash_control: false }, where: { id: storeId } });
    await db.orders.updateOne({
      data: { placed_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
      where: { id: first.id }
    });

    deepEqual(
      (await list(PosSaleList.Finalized)).map(({ id }) => id),
      [second.id]
    );
  });
});
