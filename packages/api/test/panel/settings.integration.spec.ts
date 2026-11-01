import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { CashRepository } from '../../src/cash/repository';
import { Fulfillment } from '../../src/orders/types';
import { getMeHandler } from '../../src/panel/endpoints/get-me';
import { getSettingsHandler } from '../../src/panel/endpoints/get-settings';
import { updateDeliveryHandler } from '../../src/panel/endpoints/update-delivery';
import { updateHoursHandler } from '../../src/panel/endpoints/update-hours';
import { updatePaymentHandler } from '../../src/panel/endpoints/update-payment';
import { updatePolicyHandler } from '../../src/panel/endpoints/update-policy';
import { updatePosSettingsHandler } from '../../src/panel/endpoints/update-pos-settings';
import { updateStaffSettingsHandler } from '../../src/panel/endpoints/update-staff-settings';
import { updateStockAlertHandler } from '../../src/panel/endpoints/update-stock-alert';
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
  const conflictField = (field: string) => (error: unknown) =>
    error instanceof HttpConflictError && error.context?.field === field;

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

  it('saves the stock alert phone and hour and reads them back', async () => {
    const { identity, storeId } = await setup();

    const response = await updateStockAlertHandler(
      { identity, body: { stockAlertPhone: '(11) 99999-8888', stockAlertHour: 7 } } as never,
      { db }
    );

    deepEqual(response.body, { stockAlertPhone: '5511999998888', stockAlertHour: 7 });

    const settings = await getSettingsHandler({ identity } as never, { db });

    equal(settings.body.stockAlertPhone, '5511999998888');
    equal(settings.body.stockAlertHour, 7);

    await updateStockAlertHandler({ identity, body: { stockAlertPhone: null, stockAlertHour: null } } as never, {
      db
    });

    const stored = await db.stores.findOne({
      select: { stock_alert_phone: true, stock_alert_hour: true },
      where: { id: storeId }
    });

    deepEqual(stored, { stock_alert_phone: null, stock_alert_hour: null });
  });

  it('defaults and round-trips the POS settings and refuses a bad receipt width', async () => {
    const { identity } = await setup();
    const save = (body: object) => updatePosSettingsHandler({ identity, body } as never, { db });
    const defaults = { layout: 'grid', cashControl: true, blindClose: false, receiptWidth: 80 };

    deepEqual((await getSettingsHandler({ identity } as never, { db })).body.pos, defaults);

    const next = { layout: 'search', cashControl: false, blindClose: true, receiptWidth: 58 };

    deepEqual((await save(next)).body, next);
    deepEqual((await getSettingsHandler({ identity } as never, { db })).body.pos, next);

    await rejects(save({ ...next, receiptWidth: 70 }), badField('pos_receipt_width'));
    await rejects(save({ ...next, layout: 'list' }), badField('pos_layout'));
  });

  it('refuses turning cash control off while a cash session is open', async () => {
    const { identity, storeId } = await setup();
    const save = (cashControl: boolean) =>
      updatePosSettingsHandler(
        { identity, body: { layout: 'grid', cashControl, blindClose: false, receiptWidth: 80 } } as never,
        { db }
      );

    const session = await CashRepository.open(db, storeId, { floatCents: 1000, author: 'user_1' });

    await rejects(save(false), conflictField('pos_cash_control'));
    equal((await save(true)).body.cashControl, true);

    await CashRepository.close(db, storeId, session.id, { countedCents: 1000, author: 'user_1' });
    equal((await save(false)).body.cashControl, false);
  });

  it('saves staff settings with defaults and refuses out-of-range values', async () => {
    const { identity } = await setup();
    const save = (body: object) =>
      updateStaffSettingsHandler(
        {
          identity,
          body: { idleMinutes: 30, discountLimitPercent: 0, courierFeeMode: 'order_fee', courierFeeCents: 0, ...body }
        } as never,
        { db }
      );
    const read = async () => (await getSettingsHandler({ identity } as never, { db })).body.staff;

    deepEqual(await read(), {
      idleMinutes: 15,
      discountLimitPercent: 10,
      courierFeeMode: 'order_fee',
      courierFeeCents: 0
    });

    await save({ idleMinutes: 30, discountLimitPercent: 0 });
    deepEqual(await read(), {
      idleMinutes: 30,
      discountLimitPercent: 0,
      courierFeeMode: 'order_fee',
      courierFeeCents: 0
    });

    await save({ courierFeeMode: 'fixed', courierFeeCents: 500 });
    deepEqual(await read(), {
      idleMinutes: 30,
      discountLimitPercent: 0,
      courierFeeMode: 'fixed',
      courierFeeCents: 500
    });

    await rejects(save({ courierFeeMode: 'other' }), badField('courier_fee_mode'));
    await rejects(save({ courierFeeCents: -1 }), badField('courier_fee_cents'));

    await rejects(save({ idleMinutes: 0, discountLimitPercent: 10 }), badField('idle_minutes'));
    await rejects(save({ idleMinutes: 241, discountLimitPercent: 10 }), badField('idle_minutes'));
    await rejects(save({ idleMinutes: 15, discountLimitPercent: 101 }), badField('discount_limit_percent'));
    await rejects(save({ idleMinutes: 15, discountLimitPercent: -1 }), badField('discount_limit_percent'));
  });

  it('refuses a stock alert hour outside 0-23 or a phone that is not Brazilian', async () => {
    const { identity } = await setup();
    const save = (body: object) => updateStockAlertHandler({ identity, body } as never, { db });

    await rejects(save({ stockAlertPhone: null, stockAlertHour: 24 }), badField('stock_alert_hour'));
    await rejects(save({ stockAlertPhone: null, stockAlertHour: -1 }), badField('stock_alert_hour'));
    await rejects(save({ stockAlertPhone: null, stockAlertHour: 7.5 }), badField('stock_alert_hour'));
    await rejects(save({ stockAlertPhone: '123', stockAlertHour: 9 }), badField('stock_alert_phone'));
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
      delivery: { mode: DeliveryMode.Flat, flatFeeCents: 600, zones: [], bands: [] },
      paymentMethods: [PaymentMethod.Pix, PaymentMethod.Cash],
      policy: {
        minOrderCents: 3000,
        maxOrderCents: null,
        maxChangeCents: null,
        maxItemQty: null,
        newCustomerReviewCents: null,
        lastOrderMinutes: null,
        deliveryMinMinutes: null,
        deliveryMaxMinutes: null,
        sop: 'Sem troco.',
        previousAddress: null,
        repeatOrderStatuses: null,
        newOrderAfterStatus: null,
        addOnCategoryIds: null,
        addOnExtraMinutes: null
      },
      storeLocation: null,
      stockAlertPhone: null,
      stockAlertHour: null,
      pos: { layout: 'grid', cashControl: true, blindClose: false, receiptWidth: 80 },
      staff: { idleMinutes: 15, discountLimitPercent: 10, courierFeeMode: 'order_fee', courierFeeCents: 0 }
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

  it('saves voucher as a payment method', async () => {
    const { identity, storeId } = await setup();

    await updatePaymentHandler(
      { identity, body: { paymentMethods: [PaymentMethod.Pix, PaymentMethod.Voucher] } } as never,
      { db }
    );

    deepEqual((await StoreRepository.getSettings(db, storeId))?.paymentMethods, ['pix', 'voucher']);
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
