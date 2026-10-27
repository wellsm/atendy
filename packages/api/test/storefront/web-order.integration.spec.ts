import type { HttpError } from '@ez4/gateway';
import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpForbiddenError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { DEFAULT_WEB_ORDER_PERCENT } from '../../src/billing/progress';
import { BillingOutcome } from '../../src/billing/types';
import { ConversationRepository } from '../../src/conversations/repository';
import { OrderRepository } from '../../src/orders/repository';
import { webStatusNotification } from '../../src/orders/status';
import { OrderStatus } from '../../src/orders/types';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { createWebOrderHandler } from '../../src/storefront/endpoints/create-order';
import { listMyOrdersHandler } from '../../src/storefront/endpoints/list-my-orders';
import { quoteWebOrderHandler } from '../../src/storefront/endpoints/quote-order';
import { phoneToken } from '../../src/storefront/phone-code';
import { normalizePhone, phoneVariants } from '../../src/storefront/web-order';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { groupIdOf, optionIdOf, productByName, seedMenu, seedStore } from '../support/fixtures';

describe('web orders (public menu)', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  // Ez4 restores client mocks after each test: take a fresh one per test.
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  const setup = async (overrides: Parameters<typeof seedStore>[1] = {}) => {
    const { storeId } = await seedStore(db, { flat_fee_cents: 500, ...overrides });
    const menu = await seedMenu(db, storeId);
    const broto = productByName(menu, 'Pizza Broto');
    const slug = `t-${storeId}`;

    const items = [
      {
        productId: broto.id,
        qty: 2,
        selections: [{ groupId: groupIdOf(broto, 'Sabor'), optionIds: [optionIdOf(broto, 'Sabor', 'Calabresa')] }],
        notes: 'bem assada'
      }
    ];

    // A verified phone (the code check itself is in phone-code.integration.spec.ts).
    const verified = (phone: string) => phoneToken(normalizePhone(phone) ?? phone, Date.now() + 60_000);

    const order = (body: Record<string, unknown> = {}) =>
      createWebOrderHandler(
        {
          parameters: { slug },
          body: {
            name: 'Ana',
            phone: '(11) 98888-7777',
            phoneToken: verified(String(body.phone ?? '(11) 98888-7777')),
            items,
            delivery: { fulfillment: 'delivery', address: 'Rua das Flores, 10', neighborhood: 'Centro' },
            payment: { method: 'pix' },
            ...body
          }
        } as never,
        { db, panelEvents }
      );

    return { storeId, slug, items, order, broto };
  };

  it('normalizes Brazilian phones and knows the old 8-digit WhatsApp form', () => {
    equal(normalizePhone('(11) 98888-7777'), '5511988887777');
    equal(normalizePhone('+55 11 3333-4444'), '551133334444');
    equal(normalizePhone('123'), undefined);
    deepEqual(phoneVariants('5511988887777'), ['5511988887777', '551188887777']);
  });

  it('quotes subtotal and fee without writing anything', async () => {
    const { storeId, slug, items } = await setup();

    const { body } = await quoteWebOrderHandler(
      { parameters: { slug }, body: { items, delivery: { fulfillment: 'delivery' } } } as never,
      { db, panelEvents }
    );

    equal(body.feeCents, 500);
    equal(body.totalCents, body.subtotalCents + 500);
    equal(body.deliveryError, null);
    equal(await db.orders.count({ where: { store_id: storeId } }), 0);
  });

  it('refuses a sold-out product with a 400 on items, in the quote and the order', async () => {
    const { storeId, slug, items, order, broto } = await setup();

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Massa',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: broto.id }, [{ stockItemId: item.id, qty: 1 }]);

    const refused = (error: HttpBadRequestError) => {
      deepEqual(error.context, { field: 'items', names: ['Pizza Broto'] });
      equal(error.message, 'Esgotado: Pizza Broto.');
      return true;
    };

    await rejects(
      quoteWebOrderHandler({ parameters: { slug }, body: { items, delivery: { fulfillment: 'delivery' } } } as never, {
        db,
        panelEvents
      }),
      refused
    );
    await rejects(order(), refused);
    equal(await db.orders.count({ where: { store_id: storeId } }), 0);
  });

  it('names what ran out in Portuguese when stock cannot cover the quantity', async () => {
    const { storeId, order, broto } = await setup();

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Massa',
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });

    await StockRepository.setLinks(db, storeId, { productId: broto.id }, [{ stockItemId: item.id, qty: 1 }]);
    await StockRepository.recordEntry(db, storeId, { itemId: item.id, qty: 1, author: 'test' });

    await rejects(order(), (error: HttpBadRequestError) => {
      deepEqual(error.context, { field: 'items', names: ['Pizza Broto'] });
      equal(error.message, 'Acabou: Pizza Broto.');
      return true;
    });
    equal(await db.orders.count({ where: { store_id: storeId } }), 0);
  });

  it('places the order for the store to accept, bills the web percent and leaves a note in the conversation', async () => {
    const { storeId, order } = await setup();

    const { body } = await order();
    const [placed] = (
      await db.orders.findMany({
        select: { id: true, code: true, status: true, source: true, conversation_id: true },
        where: { store_id: storeId }
      })
    ).records;

    equal(placed?.status, OrderStatus.Placed);
    equal(placed?.source, 'web');
    equal(body.code, placed?.code);
    equal(/^[2-9A-HJKMNP-Z]{6}$/.test(body.code), true);

    const [billing] = (
      await db.billing_records.findMany({ select: { outcome: true, percent: true }, where: { store_id: storeId } })
    ).records;

    deepEqual(billing, { outcome: BillingOutcome.Web, percent: DEFAULT_WEB_ORDER_PERCENT });

    const { records: messages } = await db.messages.findMany({
      select: { body: true, processed_at: true },
      where: { conversation_id: placed.conversation_id }
    });

    equal(messages[0]?.body, `🛒 Pedido pelo site #${body.code}`);
    equal(!!messages[0]?.processed_at, true);
    deepEqual(panelEvents.sendMessage.mock.calls.at(-1)?.arguments[0], {
      storeId,
      triggers: ['orders', 'conversations']
    });

    // The same phone has an order waiting: no second one on top of it.
    await rejects(order(), (error: HttpConflictError) => {
      deepEqual(error.context, { field: 'order_in_progress' });
      return true;
    });
  });

  it("bills the store's own web percent when it has one", async () => {
    const { storeId, order } = await setup();

    await StoreRepository.setWebOrderPercent(db, storeId, 60);
    await order();

    const [billing] = (await db.billing_records.findMany({ select: { percent: true }, where: { store_id: storeId } }))
      .records;

    equal(billing?.percent, 60);
  });

  it('lists the orders of a confirmed phone with what is needed to repeat them', async () => {
    const { slug, order, broto } = await setup();
    const phone = '(11) 98888-7777';
    const token = phoneToken('5511988887777', Date.now() + 60_000);
    const { body: placed } = await order();

    const list = async (body: object) =>
      (await listMyOrdersHandler({ parameters: { slug }, body } as never, { db })).body;

    const { orders } = await list({ phone, phoneToken: token });

    equal(orders.length, 1);
    equal(orders[0]?.code, placed.code);
    deepEqual(orders[0]?.items[0], {
      productId: broto.id,
      name: 'Pizza Broto',
      qty: 2,
      options: 'Sabor: Calabresa',
      selections: [{ groupId: groupIdOf(broto, 'Sabor'), optionIds: [optionIdOf(broto, 'Sabor', 'Calabresa')] }],
      notes: 'bem assada'
    });

    await rejects(list({ phone, phoneToken: 'nope' }), HttpForbiddenError);

    deepEqual(await list({ phone: '(11) 97777-6666', phoneToken: phoneToken('5511977776666', Date.now() + 60_000) }), {
      orders: []
    });
  });

  it('never writes into or deletes a draft the bot started, and deletes only its own draft on failure', async () => {
    const { storeId, order, broto } = await setup();
    const ingested = await ConversationRepository.ingestCustomerMessage(db, {
      storeId,
      message: {
        kind: ParsedEventKind.Message,
        instance: 'i',
        providerMessageId: 'W1',
        fromMe: false,
        jid: '5511988887777@s.whatsapp.net',
        phone: '5511988887777',
        text: 'oi',
        sentAt: new Date().toISOString()
      }
    });
    const conversation = await db.conversations.findOne({
      select: { customer_id: true },
      where: { id: ingested.conversationId }
    });
    const scope = { storeId, conversationId: ingested.conversationId, customerId: conversation!.customer_id };
    const botDraft = (
      await OrderRepository.addItem(db, scope, {
        product: broto,
        qty: 1,
        selections: [{ group_id: groupIdOf(broto, 'Sabor'), option_ids: [optionIdOf(broto, 'Sabor', 'Calabresa')] }]
      })
    ).order_id;

    await rejects(order(), HttpConflictError);
    equal(await OrderRepository.findDraftId(db, scope.conversationId), botDraft);

    // Another phone, an order that fails half-way (cash change below the total): its own draft is gone.
    await rejects(order({ phone: '11 97777-1111', payment: { method: 'cash', changeForCents: 1 } }));

    const other = await db.customers.findMany({
      select: { id: true },
      where: { store_id: storeId, phone: '5511977771111' }
    });
    const { records: drafts } = await db.orders.findMany({
      select: { id: true },
      where: { customer_id: other.records[0]!.id, status: OrderStatus.Draft }
    });

    deepEqual(drafts, []);
  });

  it('refuses closed stores, bad phones and bursts; a bot filling the honeypot gets a fake success', async () => {
    const closed = await setup({ accepting_orders: false });

    await rejects(closed.order(), HttpConflictError);

    const open = await setup();

    await rejects(open.order({ phone: '123' }), HttpBadRequestError);

    const fake = await open.order({ website: 'http://spam' });

    equal(fake.body.code, '0000');
    equal(await db.orders.count({ where: { store_id: open.storeId } }), 0);

    for (let index = 0; index < 10; index++) {
      await open.order({ phone: `11 9${String(index).padStart(4, '0')}-0000` });
    }

    await rejects(open.order({ phone: '11 97777-0000' }), (error: HttpError) => error.status === 429);
  });

  it('asks for the location when distance delivery has no GPS and the address is not found', async () => {
    const { storeId, slug, items } = await setup();

    await StoreRepository.setStoreLocation(db, storeId, {
      address: 'Praça da Sé',
      latitude: -23.55,
      longitude: -46.63
    });
    await StoreRepository.replaceDelivery(db, storeId, {
      mode: DeliveryMode.ByDistance,
      flatFeeCents: 0,
      zones: [],
      bands: [{ maxMeters: 5000, feeCents: 900 }]
    });

    const quote = (location?: { latitude: number; longitude: number }) =>
      quoteWebOrderHandler(
        { parameters: { slug }, body: { items, delivery: { fulfillment: 'delivery', location } } } as never,
        { db, panelEvents }
      );

    equal((await quote()).body.deliveryError, 'location_needed');

    const near = await quote({ latitude: -23.551, longitude: -46.634 });

    equal(near.body.feeCents, 900);
    equal((await quote({ latitude: -22.9, longitude: -43.2 })).body.deliveryError, 'out_of_area');
  });

  it('repeats the web order when accepted', () => {
    const text = webStatusNotification('✅ Pedido #K7Q2MX aceito!', OrderStatus.Accepted, {
      items: [{ qty: 2, product_name: 'Pizza Broto', options: 'Sabor: Calabresa' }],
      fulfillment: 'pickup' as never,
      payment_method: PaymentMethod.Cash,
      change_for_cents: 10000,
      total_cents: 6000
    });

    equal(
      text,
      [
        '✅ Pedido #K7Q2MX aceito!',
        '',
        '➡️ 2x Pizza Broto',
        '   • Sabor: Calabresa',
        '',
        '🛍️ Retirada na loja',
        '💵 Dinheiro (troco para R$ 100,00)',
        '',
        '💰 *Total: R$ 60,00*'
      ].join('\n')
    );
  });
});
