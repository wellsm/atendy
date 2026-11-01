import type { Db } from '../../src/db';
import type { OperatorHeaders } from '../../src/staff/authorize';

import { equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import { HttpForbiddenError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';
import { BucketTester } from '@ez4/local-storage/test';

import { openCashSessionHandler } from '../../src/cash/endpoints/open-session';
import { CashRepository } from '../../src/cash/repository';
import { OrderStatus } from '../../src/orders/types';
import { updateOrderHandler } from '../../src/panel/endpoints/update-order';
import { updateProductHandler } from '../../src/panel/endpoints/update-product';
import { updateStoreHandler } from '../../src/panel/endpoints/update-store';
import { addPosSaleItemHandler } from '../../src/pos/endpoints/add-item';
import { cancelPosSaleHandler } from '../../src/pos/endpoints/cancel-sale';
import { createPosSaleHandler } from '../../src/pos/endpoints/create-sale';
import { finalizePosSaleHandler } from '../../src/pos/endpoints/finalize-sale';
import { removePosSaleItemHandler } from '../../src/pos/endpoints/remove-item';
import { updatePosSaleHandler } from '../../src/pos/endpoints/update-sale';
import { PosRepository } from '../../src/pos/repository';
import { Permission } from '../../src/staff/permissions';
import { StaffRepository } from '../../src/staff/repository';
import { StaffRole } from '../../src/staff/types';
import { createStockEntryHandler } from '../../src/stock/endpoints/create-entry';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { StoreRepository } from '../../src/stores/repository';
import { PaymentMethod } from '../../src/stores/types';
import { placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';
import { operatorHeaders } from '../support/staff';

describe('panel write enforcement', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const productImages = BucketTester.getClientMock('ProductImages');
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  const person = (role: StaffRole) => ({ name: role, role, delivers: false, phone: null, pin: '1234' });

  const refused = (field: string) => (error: unknown) =>
    error instanceof HttpForbiddenError && error.context?.field === field;

  const setup = async (locked: boolean) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash] });
    const menu = await seedMenu(db, storeId);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });
    await StoreRepository.setStaffSettings(db, storeId, {
      idleMinutes: 5,
      discountLimitPercent: 10,
      courierFeeMode: 'order_fee',
      courierFeeCents: 0
    });

    const identity = { userId: 'user_owner', orgId };
    const coca = productByName(menu, 'Coca-Cola 2L');

    if (!locked) {
      return {
        storeId,
        menu,
        coca,
        identity,
        as: (..._args: unknown[]) => ({}) as OperatorHeaders,
        ids: {} as Record<string, string>
      };
    }

    const manager = await StaffRepository.create(db, storeId, person(StaffRole.Manager));
    const cashier = await StaffRepository.create(db, storeId, person(StaffRole.Cashier));
    const kitchen = await StaffRepository.create(db, storeId, person(StaffRole.Kitchen));

    const as = (staff: { id: string; role: StaffRole }, approval?: Permission): OperatorHeaders =>
      operatorHeaders(
        { storeId, staffId: staff.id, role: staff.role, version: 0 },
        approval && { storeId, staffId: manager.id, permission: approval }
      );

    return {
      storeId,
      menu,
      coca,
      identity,
      as,
      ids: { manager: manager.id, cashier: cashier.id, kitchen: kitchen.id },
      people: { manager, cashier, kitchen }
    };
  };

  const heldSale = async (storeId: string, coca: ReturnType<typeof productByName>) => {
    const { id } = await PosRepository.createSale(db, storeId, { id: randomUUID(), author: 'seed' });

    await PosRepository.addLine(db, storeId, id, { product: coca, qty: 1, selections: [] });

    return id;
  };

  it('lets a cashier sell and records the cashier as author', async () => {
    const { storeId, coca, identity, as, people } = await setup(true);
    const saleId = await heldSale(storeId, coca);

    await CashRepository.open(db, storeId, { floatCents: 0, author: 'seed' });

    await finalizePosSaleHandler(
      {
        identity,
        headers: as(people!.cashier),
        parameters: { saleId },
        body: { payments: [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }] }
      } as never,
      { db, panelEvents }
    );

    const order = await db.orders.findOne({ select: { status: true }, where: { id: saleId } });

    equal(order?.status, OrderStatus.Done);

    const cash = await db.cash_sessions.findMany({ select: { opened_by: true }, where: { store_id: storeId } });

    equal(cash.records.length, 1);
  });

  it('records the cashier as the session opener', async () => {
    const { storeId, identity, as, people } = await setup(true);

    await openCashSessionHandler({ identity, headers: as(people!.cashier), body: { floatCents: 100 } } as never, {
      db
    });

    const session = await db.cash_sessions.findMany({ select: { opened_by: true }, where: { store_id: storeId } });

    equal(session.records[0]?.opened_by, people!.cashier.id);
  });

  it('asks for approval to cancel a sale and records the approving manager', async () => {
    const { storeId, coca, identity, as, people } = await setup(true);
    const saleId = await heldSale(storeId, coca);

    await CashRepository.open(db, storeId, { floatCents: 0, author: 'seed' });

    await PosRepository.finalize(db, storeId, saleId, {
      payments: [{ method: PaymentMethod.Pix, amountCents: coca.price_cents }],
      author: 'seed'
    });

    const cancel = (headers: OperatorHeaders) =>
      cancelPosSaleHandler({ identity, headers, parameters: { saleId }, body: { reason: 'Erro' } } as never, {
        db,
        panelEvents
      });

    await rejects(cancel(as(people!.cashier)), refused('approval_required'));

    const canceled = await cancel(as(people!.cashier, Permission.PosCancel));

    const order = await db.orders.findOne({ select: { canceled_by: true }, where: { id: saleId } });

    equal(order?.canceled_by, people!.manager.id);
    equal(canceled.body.sale.canceledBy, people!.manager.id);
  });

  it('refuses a cashier editing a product', async () => {
    const { identity, as, people, menu } = await setup(true);
    const product = menu[0]!;

    await rejects(
      updateProductHandler(
        { identity, headers: as(people!.cashier), parameters: { productId: product.id }, body: product } as never,
        { db, productImages }
      ),
      refused('forbidden')
    );
  });

  it('lets the kitchen accept but not cancel an order', async () => {
    const { storeId, identity, as, people, menu } = await setup(true);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu);

    const move = (status: OrderStatus) =>
      updateOrderHandler(
        { identity, headers: as(people!.kitchen), parameters: { orderId }, body: { status } } as never,
        { db, panelEvents }
      );

    equal((await move(OrderStatus.Accepted)).status, 200);

    await rejects(move(OrderStatus.Canceled), refused('forbidden'));
  });

  it('lets the kitchen pause orders but not rename the store', async () => {
    const { storeId, identity, as, people } = await setup(true);

    const update = (body: { name?: string; acceptingOrders?: boolean }) =>
      updateStoreHandler({ identity, headers: as(people!.kitchen), body } as never, { db });

    equal((await update({ acceptingOrders: false })).body.store.acceptingOrders, false);

    await rejects(update({ name: 'Outra', acceptingOrders: true }), refused('forbidden'));
    await rejects(update({ name: 'Outra' }), refused('forbidden'));

    const store = await db.stores.findOne({ select: { name: true }, where: { id: storeId } });

    equal(store?.name === 'Outra', false);
  });

  it('refuses a stock entry from the kitchen', async () => {
    const { storeId, identity, as, people } = await setup(true);

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await rejects(
      createStockEntryHandler({ identity, headers: as(people!.kitchen), body: { itemId: item.id, qty: 1 } } as never, {
        db
      }),
      refused('forbidden')
    );
  });

  it('asks for approval above the discount limit', async () => {
    const { storeId, coca, identity, as, people } = await setup(true);
    const saleId = await heldSale(storeId, coca);

    const discount = (percent: number) =>
      updatePosSaleHandler(
        {
          identity,
          headers: as(people!.cashier),
          parameters: { saleId },
          body: { discount: { kind: 'percent', value: percent } }
        } as never,
        { db }
      );

    await rejects(discount(15), refused('approval_required'));
    equal((await discount(10)).status, 200);

    await rejects(
      addPosSaleItemHandler(
        {
          identity,
          headers: as(people!.cashier),
          parameters: { saleId },
          body: { productId: coca.id, qty: 1, selections: [], discount: { kind: 'percent', value: 50 } }
        } as never,
        { db }
      ),
      refused('approval_required')
    );
  });

  it('guards the discount proportion when a line is removed', async () => {
    const { storeId, coca, identity, as, people } = await setup(true);
    const saleId = await heldSale(storeId, coca);

    await PosRepository.addLine(db, storeId, saleId, { product: coca, qty: 1, selections: [] });
    await PosRepository.updateSale(db, storeId, saleId, {
      discount: { kind: 'value', value: Math.floor(coca.price_cents / 5) }
    });

    const { items } = await PosRepository.getSale(db, storeId, saleId);

    const remove = (headers: OperatorHeaders) =>
      removePosSaleItemHandler({ identity, headers, parameters: { saleId, itemId: items[0]!.itemId } } as never, {
        db
      });

    await rejects(remove(as(people!.cashier)), refused('approval_required'));
    equal((await PosRepository.getSale(db, storeId, saleId)).items.length, 2);

    equal((await remove(as(people!.cashier, Permission.PosDiscountOverLimit))).status, 200);
    equal((await PosRepository.getSale(db, storeId, saleId)).items.length, 1);
  });

  it('keeps an unlocked store working with the Clerk user as author', async () => {
    const { storeId, coca, identity } = await setup(false);
    const saleId = await heldSale(storeId, coca);

    await CashRepository.open(db, storeId, { floatCents: 0, author: 'seed' });

    await updatePosSaleHandler(
      {
        identity,
        parameters: { saleId },
        body: { discount: { kind: 'percent', value: 50 } }
      } as never,
      { db }
    );

    await finalizePosSaleHandler(
      {
        identity,
        parameters: { saleId },
        body: { payments: [{ method: PaymentMethod.Pix, amountCents: coca.price_cents / 2 }] }
      } as never,
      { db, panelEvents }
    );

    await cancelPosSaleHandler({ identity, parameters: { saleId }, body: { reason: 'Erro' } } as never, {
      db,
      panelEvents
    });

    const order = await db.orders.findOne({ select: { canceled_by: true }, where: { id: saleId } });

    equal(order?.canceled_by, 'user_owner');

    const created = await createPosSaleHandler({ identity, parameters: { saleId: randomUUID() }, body: {} } as never, {
      db
    });
    const made = await db.orders.findOne({ select: { created_by: true }, where: { id: created.body.sale.id } });

    equal(made?.created_by, 'user_owner');
  });

  it('lets an unlocked store edit products, move orders and stock, and open cash as the Clerk user', async () => {
    const { storeId, identity, menu } = await setup(false);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu);
    const product = menu[0]!;
    const body = {
      categoryId: product.category_id,
      name: 'Novo',
      description: null,
      priceCents: 500,
      active: true,
      groups: []
    };

    await updateProductHandler({ identity, parameters: { productId: product.id }, body } as never, {
      db,
      productImages
    });

    equal(
      (
        await updateOrderHandler(
          { identity, parameters: { orderId }, body: { status: OrderStatus.Canceled } } as never,
          {
            db,
            panelEvents
          }
        )
      ).status,
      200
    );

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Coca',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await createStockEntryHandler({ identity, body: { itemId: item.id, qty: 1 } } as never, { db });

    const entry = await db.stock_movements.findMany({ select: { author: true }, where: { store_id: storeId } });

    equal(entry.records[0]?.author, 'user_owner');

    await openCashSessionHandler({ identity, body: { floatCents: 100 } } as never, { db });

    const session = await db.cash_sessions.findMany({ select: { opened_by: true }, where: { store_id: storeId } });

    equal(session.records[0]?.opened_by, 'user_owner');
  });
});
