import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { BucketTester } from '@ez4/local-storage/test';

import { MenuRepository } from '../../src/menu/repository';
import { listPanelStoresHandler } from '../../src/panel/endpoints/list-stores';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { deliveryFromCents } from '../../src/storefront/delivery';
import { getStorefrontHandler } from '../../src/storefront/endpoints/get-store';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';
import { seedMenu, seedStore } from '../support/fixtures';

describe('storefront', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const productImages = BucketTester.getClientMock('ProductImages');

  const get = (slug: string) => getStorefrontHandler({ parameters: { slug } } as never, { db, productImages });

  it('returns the store header and the active menu of an active store', async () => {
    const { storeId } = await seedStore(db, {
      flat_fee_cents: 500,
      payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash],
      policy: { min_order_cents: 2500 }
    });
    const menu = await seedMenu(db, storeId);
    const hidden = menu[0]!;

    await MenuRepository.setProductActive(db, storeId, hidden.id, false);

    const { body } = await get(`t-${storeId}`);

    deepEqual(body.store, {
      name: 'Pizzaria Teste',
      slug: `t-${storeId}`,
      open: true,
      closesAt: null,
      deliveryFromCents: 500,
      minOrderCents: 2500,
      paymentMethods: [PaymentMethod.Pix, PaymentMethod.Cash],
      deliveryMode: DeliveryMode.Flat
    });

    const products = body.categories.flatMap(({ products }) => products);

    equal(products.length, menu.length - 1);
    equal(
      products.some(({ id }) => id === hidden.id),
      false
    );
    equal(
      body.categories.every(({ products }) => products.length > 0),
      true
    );
  });

  it('flags sold-out products and options without exposing stock', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const coca = menu.find(({ name }) => name === 'Coca-Cola 2L')!;
    const grande = menu.find(({ name }) => name === 'Pizza Grande')!;
    const calabresa = grande.groups[0]!.options[0]!;

    const newItem = (name: string) =>
      StockRepository.createItem(db, storeId, { name, unit: StockUnit.Unit, barcode: null, minQty: null });

    const [cocaItem, flavorItem] = [await newItem('Coca'), await newItem('Calabresa')];

    await StockRepository.setLinks(db, storeId, { productId: coca.id }, [{ stockItemId: cocaItem.id, qty: 1 }]);
    await StockRepository.setLinks(db, storeId, { optionId: calabresa.id }, [{ stockItemId: flavorItem.id, qty: 1 }]);

    const { body } = await get(`t-${storeId}`);
    const products = body.categories.flatMap(({ products }) => products);

    deepEqual(
      products.map(({ name, soldOut }) => [name, soldOut]),
      menu
        .map(({ name }) => [name, name === 'Coca-Cola 2L'])
        .sort(
          (a, b) => products.findIndex(({ name }) => name === a[0]) - products.findIndex(({ name }) => name === b[0])
        )
    );

    const options = products.find(({ id }) => id === grande.id)!.groups[0]!.options;

    deepEqual(
      options.map(({ id, soldOut }) => [id, soldOut]),
      grande.groups[0]!.options.map(({ id }) => [id, id === calabresa.id])
    );

    const json = JSON.stringify(body);

    equal(json.includes(cocaItem.id), false);
    equal(json.includes('balance'), false);
  });

  it('is closed when the store is not accepting orders, whatever the hours say', async () => {
    const { storeId } = await seedStore(db, { accepting_orders: false });

    equal((await get(`t-${storeId}`)).body.store.open, false);
  });

  it('hides inactive and unknown stores', async () => {
    const { storeId } = await seedStore(db, { active: false });

    await rejects(get(`t-${storeId}`), HttpNotFoundError);
    await rejects(get(`t-${randomUUID()}`), HttpNotFoundError);
  });

  it('shows the cheapest fee of the delivery mode', () => {
    const base = { flatFeeCents: 700, zones: [], bands: [] };

    equal(deliveryFromCents({ ...base, mode: DeliveryMode.Flat }), 700);
    equal(deliveryFromCents({ ...base, mode: DeliveryMode.ByZone }), null);
    equal(
      deliveryFromCents({
        ...base,
        mode: DeliveryMode.ByZone,
        zones: [
          { neighborhood: 'Centro', feeCents: 600 },
          { neighborhood: 'Vila', feeCents: 400 }
        ]
      }),
      400
    );
    equal(deliveryFromCents({ ...base, mode: DeliveryMode.ByDistance, bands: [{ maxMeters: 2000, feeCents: 0 }] }), 0);
  });
});

describe('panel store list', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('maps org ids to the stores behind them', async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const store = await StoreRepository.findBySlug(db, `t-${storeId}`);
    const { body } = await listPanelStoresHandler(
      { identity: { userId: 'user_1', orgId }, query: { orgIds: ` ${orgId},org_unknown,` } } as never,
      { db }
    );

    deepEqual(body.stores, [{ orgId, slug: `t-${storeId}`, name: store!.name }]);
  });

  it('returns nothing for an empty list', async () => {
    const { body } = await listPanelStoresHandler(
      { identity: { userId: 'user_1' }, query: { orgIds: ' , ' } } as never,
      { db }
    );

    deepEqual(body.stores, []);
  });
});
