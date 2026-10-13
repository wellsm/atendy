import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { Fulfillment } from '../../src/orders/types';
import { getMeHandler } from '../../src/panel/endpoints/get-me';
import { getSettingsHandler } from '../../src/panel/endpoints/get-settings';
import { updateDeliveryHandler } from '../../src/panel/endpoints/update-delivery';
import { updateHoursHandler } from '../../src/panel/endpoints/update-hours';
import { updatePaymentHandler } from '../../src/panel/endpoints/update-payment';
import { updatePolicyHandler } from '../../src/panel/endpoints/update-policy';
import { updateStoreHandler } from '../../src/panel/endpoints/update-store';
import { resolveDeliveryFee } from '../../src/stores/delivery';
import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';
import { seedStore } from '../support/fixtures';

describe('panel settings endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async (overrides: Parameters<typeof seedStore>[1] = {}) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db, overrides);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, identity: { userId: 'user_1', orgId } };
  };

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('renames the store and flips accepting orders for the token org only', async () => {
    const { identity, storeId } = await setup();
    const other = await setup();

    const response = await updateStoreHandler(
      { identity, body: { name: '  Pizzaria Boa  ', acceptingOrders: false } } as never,
      { db }
    );

    equal(response.body.store.name, 'Pizzaria Boa');
    equal(response.body.store.acceptingOrders, false);

    const [store, untouched] = await Promise.all([
      db.stores.findOne({ select: { name: true, accepting_orders: true }, where: { id: storeId } }),
      db.stores.findOne({ select: { name: true, accepting_orders: true }, where: { id: other.storeId } })
    ]);

    deepEqual(store, { name: 'Pizzaria Boa', accepting_orders: false });
    deepEqual(untouched, { name: 'Pizzaria Teste', accepting_orders: true });
  });

  it('refuses an empty store update or a blank name', async () => {
    const { identity } = await setup();

    await rejects(updateStoreHandler({ identity, body: {} } as never, { db }), HttpBadRequestError);
    await rejects(updateStoreHandler({ identity, body: { name: '  ' } } as never, { db }), badField('name'));
  });

  it('tells whether the store is open now by its hours', async () => {
    const open = await setup();
    const closed = await setup({ hours: [] });

    const [openMe, closedMe] = await Promise.all([
      getMeHandler({ identity: open.identity } as never, { db }),
      getMeHandler({ identity: closed.identity } as never, { db })
    ]);

    equal(openMe.body.store?.openNow, true);
    equal(closedMe.body.store?.openNow, false);
  });

  it('reads the settings of the token store', async () => {
    const { identity } = await setup({
      hours: [{ weekday: 5, opens_at: '18:00', closes_at: '02:00' }],
      payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash],
      flat_fee_cents: 600,
      policy: { min_order_cents: 3000, order_memory_hours: 2, sop: 'Sem troco.' }
    });

    const response = await getSettingsHandler({ identity } as never, { db });

    deepEqual(response.body, {
      hours: [{ weekday: 5, opensAt: '18:00', closesAt: '02:00' }],
      delivery: { mode: DeliveryMode.Flat, flatFeeCents: 600, zones: [] },
      paymentMethods: [PaymentMethod.Pix, PaymentMethod.Cash],
      policy: {
        minOrderCents: 3000,
        maxOrderCents: null,
        maxChangeCents: null,
        maxItemQty: null,
        newCustomerReviewCents: null,
        lastOrderMinutes: null,
        sop: 'Sem troco.'
      }
    });
  });

  it('replaces the hours, and keeps them when the new week overlaps', async () => {
    const { identity, storeId } = await setup({ hours: [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }] });

    await rejects(
      updateHoursHandler(
        {
          identity,
          body: {
            hours: [
              { weekday: 2, opensAt: '11:00', closesAt: '15:00' },
              { weekday: 2, opensAt: '14:00', closesAt: '18:00' }
            ]
          }
        } as never,
        { db }
      ),
      badField('hours')
    );

    equal((await StoreRepository.getSettings(db, storeId))?.hours[0]?.weekday, 1);

    const response = await updateHoursHandler(
      {
        identity,
        body: {
          hours: [
            { weekday: 6, opensAt: '18:00', closesAt: '02:00' },
            { weekday: 0, opensAt: '11:00', closesAt: '15:00' }
          ]
        }
      } as never,
      { db }
    );

    deepEqual(response.body.hours, [
      { weekday: 0, opensAt: '11:00', closesAt: '15:00' },
      { weekday: 6, opensAt: '18:00', closesAt: '02:00' }
    ]);

    deepEqual((await StoreRepository.getSettings(db, storeId))?.hours, [
      { weekday: 0, opens_at: '11:00', closes_at: '15:00' },
      { weekday: 6, opens_at: '18:00', closes_at: '02:00' }
    ]);
  });

  it('switches delivery to neighborhoods the agent can price', async () => {
    const { identity, storeId } = await setup();

    await rejects(
      updateDeliveryHandler({ identity, body: { mode: DeliveryMode.ByZone, flatFeeCents: 0, zones: [] } } as never, {
        db
      }),
      badField('zones')
    );

    await rejects(
      updateDeliveryHandler(
        {
          identity,
          body: {
            mode: DeliveryMode.ByZone,
            flatFeeCents: 0,
            zones: [
              { neighborhood: 'São José', feeCents: 500 },
              { neighborhood: 'sao jose', feeCents: 700 }
            ]
          }
        } as never,
        { db }
      ),
      badField('zones')
    );

    const response = await updateDeliveryHandler(
      {
        identity,
        body: {
          mode: DeliveryMode.ByZone,
          flatFeeCents: 0,
          zones: [
            { neighborhood: 'Centro', feeCents: 0 },
            { neighborhood: 'São José', feeCents: 700 }
          ]
        }
      } as never,
      { db }
    );

    equal(response.body.delivery.mode, DeliveryMode.ByZone);

    const settings = await StoreRepository.getSettings(db, storeId);

    equal(
      resolveDeliveryFee({
        fulfillment: Fulfillment.Delivery,
        deliveryMode: settings!.delivery.mode,
        flatFeeCents: settings!.delivery.flatFeeCents,
        zones: settings!.delivery.zones.map(({ neighborhood, feeCents }) => ({ neighborhood, fee_cents: feeCents })),
        neighborhood: 'sao jose'
      }),
      700
    );
  });

  it('requires at least one payment method', async () => {
    const { identity, storeId } = await setup();

    await rejects(
      updatePaymentHandler({ identity, body: { paymentMethods: [] } } as never, { db }),
      badField('payment_methods')
    );

    const response = await updatePaymentHandler(
      { identity, body: { paymentMethods: [PaymentMethod.Card, PaymentMethod.Cash] } } as never,
      { db }
    );

    deepEqual(response.body.paymentMethods, [PaymentMethod.Card, PaymentMethod.Cash]);
    deepEqual((await StoreRepository.getSettings(db, storeId))?.paymentMethods, [
      PaymentMethod.Card,
      PaymentMethod.Cash
    ]);
  });

  it('merges the policy, clears a limit with null and keeps admin-only keys', async () => {
    const { identity, storeId } = await setup({ policy: { order_memory_hours: 2, max_item_qty: 10 } });

    const response = await updatePolicyHandler(
      { identity, body: { minOrderCents: 3000, maxItemQty: null, sop: 'Sem troco acima de R$ 50.' } } as never,
      { db }
    );

    equal(response.body.policy.minOrderCents, 3000);
    equal(response.body.policy.maxItemQty, null);

    deepEqual(await StoreRepository.getPolicy(db, storeId), {
      order_memory_hours: 2,
      max_item_qty: null,
      min_order_cents: 3000,
      sop: 'Sem troco acima de R$ 50.'
    });
  });

  it('refuses admin-only keys, bad numbers and a long SOP', async () => {
    const { identity, storeId } = await setup({ policy: { order_memory_hours: 2 } });

    await rejects(
      updatePolicyHandler({ identity, body: { orderMemoryHours: 1 } } as never, { db }),
      badField('order_memory_hours')
    );
    await rejects(
      updatePolicyHandler({ identity, body: { minOrderCents: -1 } } as never, { db }),
      badField('min_order_cents')
    );
    await rejects(updatePolicyHandler({ identity, body: { sop: 'x'.repeat(2001) } } as never, { db }), badField('sop'));

    deepEqual(await StoreRepository.getPolicy(db, storeId), { order_memory_hours: 2 });
  });
});
