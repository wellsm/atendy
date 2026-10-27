import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { connectStoreWhatsAppHandler } from '../../src/admin/endpoints/connect-store-whatsapp';
import { disconnectStoreWhatsAppHandler } from '../../src/admin/endpoints/disconnect-store-whatsapp';
import { getStoreHandler } from '../../src/admin/endpoints/get-store';
import { getStoreWhatsAppHandler } from '../../src/admin/endpoints/get-store-whatsapp';
import { listStoresHandler } from '../../src/admin/endpoints/list-stores';
import { seedDemoMenuHandler } from '../../src/admin/endpoints/seed-demo-menu';
import { updateAdminStoreHandler } from '../../src/admin/endpoints/update-store';
import { countProducts, DEMO_MENUS, DemoMenuKind } from '../../src/menu/demo-menus';
import { MenuRepository } from '../../src/menu/repository';
import { WhatsAppState } from '../../src/panel/whatsapp';
import { LLM_MODELS } from '../../src/stores/models';
import { DEFAULT_LLM_MODEL, StoreRepository } from '../../src/stores/repository';
import { RouterType } from '../../src/stores/types';
import { placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('admin store endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const identity = { userId: 'user_admin' };

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'http://evo';
    process.env.EVOLUTION_API_KEY = 'global-key';
    process.env.WEBHOOK_BASE_URL = 'http://api.test';
  });

  afterEach(() => mock.restoreAll());

  const update = (storeId: string, body: object) =>
    updateAdminStoreHandler({ identity, parameters: { storeId }, body } as never, { db });

  const detail = (storeId: string) => getStoreHandler({ identity, parameters: { storeId } } as never, { db });

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('protects every admin route with the admin authorizer', async () => {
    const source = await readFile(new URL('../../src/admin/routes.ts', import.meta.url), 'utf8');
    const paths = source.match(/path: '/g)?.length ?? 0;

    ok(paths >= 7);
    equal(source.match(/authorizer: typeof adminAuthorizer;/g)?.length, paths);
  });

  it('shows the store detail with health and the model list', async () => {
    const { storeId } = await seedStore(db, { policy: { order_memory_hours: 2 } });

    await seedConversation(db, storeId);

    const { body } = await detail(storeId);

    equal(body.store.id, storeId);
    equal(body.store.router, RouterType.Llm);
    equal(body.store.llmModel, 'test/model');
    equal(body.orderMemoryHours, 2);
    deepEqual(body.models, [...LLM_MODELS]);
    ok(body.health.lastMessageAt);
    equal(body.health.errorCount24h, 0);
    equal(body.health.openNow, true);
    equal(body.health.acceptingOrders, true);

    await rejects(detail('00000000-0000-4000-8000-000000000000'), HttpNotFoundError);
  });

  it('updates router, model and order memory', async () => {
    const { storeId } = await seedStore(db, { policy: { order_memory_hours: 2, max_item_qty: 10 } });

    const { body } = await update(storeId, {
      router: RouterType.Jev,
      llmModel: DEFAULT_LLM_MODEL,
      orderMemoryHours: 0
    });

    equal(body.store.router, RouterType.Jev);
    equal(body.store.llmModel, DEFAULT_LLM_MODEL);
    equal(body.orderMemoryHours, 0);

    await update(storeId, { orderMemoryHours: null });

    deepEqual(await StoreRepository.getPolicy(db, storeId), { order_memory_hours: null, max_item_qty: 10 });
    equal((await detail(storeId)).body.orderMemoryHours, null);
  });

  it('refuses unknown models, bad hours and an empty update', async () => {
    const { storeId } = await seedStore(db);

    await rejects(update(storeId, { llmModel: 'anthropic/typo' }), badField('llm_model'));
    await rejects(update(storeId, { orderMemoryHours: -1 }), badField('order_memory_hours'));
    await rejects(update(storeId, { orderMemoryHours: 1.5 }), badField('order_memory_hours'));
    await rejects(update(storeId, {}), HttpBadRequestError);

    equal((await detail(storeId)).body.store.llmModel, 'test/model');
  });

  it('still activates a store with the active-only body', async () => {
    const { storeId } = await seedStore(db, { active: false });

    equal((await update(storeId, { active: true })).body.store.active, true);
  });

  const seedDemo = (storeId: string, body: object) =>
    seedDemoMenuHandler({ identity, parameters: { storeId }, body } as never, { db });

  it('loads the chosen demo menu once, without touching the hours', async () => {
    const { storeId } = await seedStore(db, { hours: [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }] });
    const seed = () => seedDemo(storeId, { kind: DemoMenuKind.Burger });

    equal((await seed()).body.products, countProducts(DEMO_MENUS[DemoMenuKind.Burger]));
    ok(productByName(await MenuRepository.load(db, storeId), 'Cheese Bacon'));
    deepEqual(await StoreRepository.getHours(db, storeId), [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }]);

    await rejects(seed(), HttpConflictError);
  });

  it('refuses the demo menu when the store has only inactive products', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);

    for (const product of menu) {
      await db.products.updateOne({ data: { active: false }, where: { id: product.id } });
    }

    await rejects(seedDemo(storeId, { kind: DemoMenuKind.Pizzeria }), HttpConflictError);
  });

  it('replaces the whole menu and keeps past order items', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu);

    const { body } = await seedDemo(storeId, { kind: DemoMenuKind.Japanese, replace: true });
    const japanese = DEMO_MENUS[DemoMenuKind.Japanese];

    equal(body.products, countProducts(japanese));
    equal(await db.products.count({ where: { store_id: storeId } }), countProducts(japanese));
    equal(await db.categories.count({ where: { store_id: storeId } }), japanese.categories.length);
    equal(await db.products.count({ where: { id: productByName(menu, 'Coca-Cola 2L').id } }), 0);

    const { records: items } = await db.order_items.findMany({
      select: { product_name: true, unit_price_cents: true },
      where: { order_id: orderId }
    });

    deepEqual(items, [{ product_name: 'Coca-Cola 2L', unit_price_cents: 1400 }]);
  });

  it('keeps product and option names unique inside every demo menu', () => {
    for (const [kind, demo] of Object.entries(DEMO_MENUS)) {
      const products = demo.categories.flatMap(({ products }) => products);

      equal(new Set(products.map(({ name }) => name)).size, products.length, kind);

      for (const product of products) {
        for (const group of product.groups ?? []) {
          equal(new Set(group.options.map(({ name }) => name)).size, group.options.length, `${kind} ${product.name}`);
          ok(group.min <= group.max && group.max <= group.options.length, `${kind} ${product.name} ${group.name}`);
        }
      }
    }
  });

  it('lists stores with their router, model and health', async () => {
    const { storeId } = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    await db.conversations.updateOne({ data: { handoff_reason: 'send_failed' }, where: { id: conversationId } });

    const { body } = await listStoresHandler({ identity } as never, { db });
    const row = body.stores.find(({ id }) => id === storeId);

    equal(row?.router, RouterType.Llm);
    equal(row?.llmModel, 'test/model');
    ok(row?.lastMessageAt);
    equal(row?.errorCount24h, 1);
  });

  it('reads and drives the WhatsApp of any store', async () => {
    const { storeId } = await seedStore(db);
    const calls: string[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      const path = url.replace('http://evo', '');

      calls.push(`${init.method ?? 'GET'} ${path}`);

      if (path.startsWith('/instance/connectionState/')) {
        return Promise.resolve(new Response(JSON.stringify({ instance: { state: 'close' } }), { status: 200 }));
      }

      if (path.startsWith('/instance/connect/')) {
        return Promise.resolve(new Response(JSON.stringify({ base64: 'data:image/png;base64,QR' }), { status: 200 }));
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    const parameters = { storeId };

    equal(
      (await getStoreWhatsAppHandler({ identity, parameters } as never, { db })).body.state,
      WhatsAppState.Disconnected
    );
    equal(
      (await connectStoreWhatsAppHandler({ identity, parameters } as never, { db })).body.qrBase64,
      'data:image/png;base64,QR'
    );
    equal(
      (await disconnectStoreWhatsAppHandler({ identity, parameters } as never, { db })).body.state,
      WhatsAppState.Disconnected
    );
    ok(calls.includes(`DELETE /instance/logout/atd_${storeId}`));

    await rejects(
      getStoreWhatsAppHandler({ identity, parameters: { storeId: '00000000-0000-4000-8000-000000000000' } } as never, {
        db
      }),
      HttpNotFoundError
    );
  });
});
