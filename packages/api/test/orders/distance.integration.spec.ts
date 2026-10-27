import type { Db } from '../../src/db';
import type { Coordinates } from '../../src/stores/geo';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { CartMissing, OrderError, OrderErrorCode, OrderRepository } from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';
import { productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

/**
 * Store at Praça da Sé; MASP is about 2.6 km away, Pinheiros about 6.5 km.
 */
const STORE: Coordinates = { latitude: -23.55052, longitude: -46.633308 };
const NEAR: Coordinates = { latitude: -23.561414, longitude: -46.655881 };
const FAR: Coordinates = { latitude: -23.567, longitude: -46.693 };

const BANDS = [
  { maxMeters: 2000, feeCents: 500 },
  { maxMeters: 5000, feeCents: 900 }
];

describe('distance delivery orders', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const { storeId } = await seedStore(db, { payment_methods: [PaymentMethod.Pix] });
    const menu = await seedMenu(db, storeId);
    const conversation = await seedConversation(db, storeId);
    const scope = { storeId, ...conversation };

    await StoreRepository.setStoreLocation(db, storeId, { address: 'Praça da Sé', ...STORE });
    await StoreRepository.replaceDelivery(db, storeId, {
      mode: DeliveryMode.ByDistance,
      flatFeeCents: 0,
      zones: [],
      bands: BANDS
    });

    const addCoke = () =>
      OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });

    return { storeId, scope, addCoke };
  };

  const cartOf = async (conversationId: string) =>
    OrderRepository.getCart(db, (await OrderRepository.findDraftId(db, conversationId))!);

  it('keeps a pin sent before any item and prices it by band', async () => {
    const { scope, addCoke } = await setup();

    await OrderRepository.setLocation(db, scope, NEAR);
    await addCoke();

    const cart = await cartOf(scope.conversationId);

    equal(cart.fulfillment, Fulfillment.Delivery);
    equal(cart.fee_cents, 900);
    ok(cart.distance_km! > 2 && cart.distance_km! < 3);
    deepEqual(cart.missing, [CartMissing.Address, CartMissing.Payment]);
  });

  it('geocodes a typed address only when there is no pin', async () => {
    const { scope, addCoke } = await setup();
    const queries: string[] = [];
    const geocode = (query: string) => {
      queries.push(query);

      return Promise.resolve(NEAR);
    };

    await addCoke();
    await OrderRepository.setAddress(db, scope, { address: 'Av Paulista 1578', neighborhood: 'Bela Vista' }, geocode);

    deepEqual(queries, ['Av Paulista 1578, Bela Vista']);
    equal((await cartOf(scope.conversationId)).fee_cents, 900);

    // A later pin wins.
    await OrderRepository.setLocation(db, scope, { latitude: -23.551, longitude: -46.634 });
    equal((await cartOf(scope.conversationId)).fee_cents, 500);

    // A typed address after the pin keeps the pin.
    await OrderRepository.setAddress(db, scope, { address: 'Rua X 10', neighborhood: null }, geocode);
    equal(queries.length, 1);
    equal((await cartOf(scope.conversationId)).fee_cents, 500);
  });

  it('asks for the location when the address cannot be placed, keeping the text', async () => {
    const { scope, addCoke } = await setup();

    await addCoke();

    await rejects(
      OrderRepository.setAddress(db, scope, { address: 'Rua Sem Nome', neighborhood: null }, () =>
        Promise.resolve(undefined)
      ),
      (error: unknown) => error instanceof OrderError && error.code === OrderErrorCode.LocationNeeded
    );

    const cart = await cartOf(scope.conversationId);

    equal(cart.address, 'Rua Sem Nome');
    ok(cart.missing.includes(CartMissing.Location));
  });

  it('refuses delivery beyond the last band', async () => {
    const { scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setLocation(db, scope, FAR);
    await OrderRepository.setAddress(db, scope, { address: 'Rua Longe 1', neighborhood: null });
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const cart = await cartOf(scope.conversationId);

    ok(cart.missing.includes(CartMissing.DeliveryArea));
    await rejects(
      OrderRepository.place(db, scope),
      (error: unknown) => error instanceof OrderError && error.code === OrderErrorCode.Incomplete
    );
  });

  it('prices with the current bands and mode', async () => {
    const { storeId, scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setLocation(db, scope, NEAR);

    await StoreRepository.replaceDelivery(db, storeId, {
      mode: DeliveryMode.ByDistance,
      flatFeeCents: 0,
      zones: [],
      bands: [{ maxMeters: 3000, feeCents: 300 }]
    });
    equal((await cartOf(scope.conversationId)).fee_cents, 300);

    await StoreRepository.replaceDelivery(db, storeId, { mode: DeliveryMode.Flat, flatFeeCents: 700, zones: [] });

    const cart = await cartOf(scope.conversationId);

    equal(cart.fee_cents, 700);
    equal(cart.missing.includes(CartMissing.Location), false);
  });

  it('ignores a pin when the store does not deliver by distance', async () => {
    const { storeId } = await seedStore(db);
    const conversation = await seedConversation(db, storeId);

    await OrderRepository.setLocation(db, { storeId, ...conversation }, NEAR);

    equal(await OrderRepository.findDraftId(db, conversation.conversationId), undefined);
  });

  it('geocodes again when a typed address replaces another typed address', async () => {
    const { scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setAddress(db, scope, { address: 'Perto 1', neighborhood: null }, () =>
      Promise.resolve(NEAR)
    );
    equal((await cartOf(scope.conversationId)).fee_cents, 900);

    await OrderRepository.setAddress(db, scope, { address: 'Longe 2', neighborhood: null }, () => Promise.resolve(FAR));
    ok((await cartOf(scope.conversationId)).missing.includes(CartMissing.DeliveryArea));

    await rejects(
      OrderRepository.setAddress(db, scope, { address: 'Sem Nome', neighborhood: null }, () =>
        Promise.resolve(undefined)
      ),
      (error: unknown) => error instanceof OrderError && error.code === OrderErrorCode.LocationNeeded
    );

    const cart = await cartOf(scope.conversationId);

    ok(cart.missing.includes(CartMissing.Location));
    equal(cart.distance_km, undefined);
  });

  it('says out of area for a far pin before any address', async () => {
    const { scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setLocation(db, scope, FAR);

    ok((await cartOf(scope.conversationId)).missing.includes(CartMissing.DeliveryArea));
  });

  it('ignores a pin while the store is preparing the last order', async () => {
    const { storeId, scope, addCoke } = await setup();

    await addCoke();
    await OrderRepository.setLocation(db, scope, NEAR);
    await OrderRepository.setAddress(db, scope, { address: 'Rua A 1', neighborhood: null });
    await OrderRepository.setPayment(db, scope, { method: PaymentMethod.Pix });

    const { order_id: orderId } = await OrderRepository.place(db, scope);

    await OrderRepository.setStatus(db, { storeId, orderId, status: OrderStatus.Accepted });
    await OrderRepository.setLocation(db, scope, { latitude: -23.551, longitude: -46.634 });

    equal(await OrderRepository.findDraftId(db, scope.conversationId), undefined);
  });
});
