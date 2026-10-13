import type { Db } from '../../src/db';

import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { StoreRepository } from '../../src/stores/repository';
import { DeliveryMode, PaymentMethod, RouterType } from '../../src/stores/types';

describe('StoreRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('creates a store with safe defaults and a unique webhook secret', async () => {
    const first = await StoreRepository.create(db, { name: 'A', slug: `a-${randomUUID()}`, llmModel: 'test/model' });
    const second = await StoreRepository.create(db, { name: 'B', slug: `b-${randomUUID()}`, llmModel: 'test/model' });

    notEqual(first.whatsappWebhookSecret, second.whatsappWebhookSecret);
    ok(first.whatsappWebhookSecret.length >= 32);

    const store = (await StoreRepository.list(db)).find(({ id }) => id === first.id);

    equal(store?.accepting_orders, false);
    equal(store?.router, RouterType.Llm);
  });

  it('rejects a duplicate slug', async () => {
    const slug = `dup-${randomUUID()}`;

    await StoreRepository.create(db, { name: 'A', slug, llmModel: 'test/model' });

    await rejects(StoreRepository.create(db, { name: 'B', slug, llmModel: 'test/model' }));
  });

  it('toggles accepting orders and switches router', async () => {
    const { id } = await StoreRepository.create(db, { name: 'C', slug: `c-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.setAcceptingOrders(db, id, true);
    await StoreRepository.setRouter(db, id, RouterType.Jev);

    const store = (await StoreRepository.list(db)).find((item) => item.id === id);

    equal(store?.accepting_orders, true);
    equal(store?.router, RouterType.Jev);
  });

  it('saves the WhatsApp instance and token and returns the webhook secret', async () => {
    const { id, whatsappWebhookSecret } = await StoreRepository.create(db, {
      name: 'W',
      slug: `w-${randomUUID()}`,
      llmModel: 'test/model'
    });

    await StoreRepository.setWhatsAppInstance(db, id, { instance: `atd_${id}`, token: 'tok' });

    const store = await db.stores.findOne({
      select: { whatsapp_instance: true, whatsapp_instance_token: true },
      where: { id }
    });

    equal(store?.whatsapp_instance, `atd_${id}`);
    equal(store?.whatsapp_instance_token, 'tok');
    equal(await StoreRepository.getWebhookSecret(db, id), whatsappWebhookSecret);
  });

  it('replaces the opening hours', async () => {
    const { id } = await StoreRepository.create(db, { name: 'H', slug: `h-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.replaceHours(db, id, [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }]);
    await StoreRepository.replaceHours(db, id, [
      { weekday: 2, opens_at: '18:00', closes_at: '23:30' },
      { weekday: 3, opens_at: '00:00', closes_at: '00:00' }
    ]);

    const { records } = await db.store_hours.findMany({
      select: { weekday: true, opens_at: true, closes_at: true },
      where: { store_id: id }
    });

    equal(records.length, 2);
    equal(
      records.some(({ weekday }) => weekday === 1),
      false
    );
  });

  it('keeps the old hours when replacing them fails midway', async () => {
    const { id } = await StoreRepository.create(db, { name: 'H', slug: `h-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.replaceHours(db, id, [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }]);

    await rejects(
      StoreRepository.replaceHours(db, id, [
        { weekday: 2, opens_at: '18:00', closes_at: '23:30' },
        { weekday: 3, opens_at: 'not a time', closes_at: '23:00' }
      ])
    );

    const { records } = await db.store_hours.findMany({
      select: { weekday: true, opens_at: true, closes_at: true },
      where: { store_id: id }
    });

    deepEqual(records, [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }]);
  });

  it('replaces the delivery settings and clears zones in flat mode', async () => {
    const { id } = await StoreRepository.create(db, { name: 'D', slug: `d-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.replaceDelivery(db, id, {
      mode: DeliveryMode.ByZone,
      flatFeeCents: 0,
      zones: [
        { neighborhood: 'Centro', feeCents: 500 },
        { neighborhood: 'São José', feeCents: 800 }
      ]
    });

    let settings = await StoreRepository.getSettings(db, id);

    equal(settings?.delivery.mode, DeliveryMode.ByZone);
    deepEqual(settings?.delivery.zones, [
      { neighborhood: 'Centro', feeCents: 500 },
      { neighborhood: 'São José', feeCents: 800 }
    ]);

    await StoreRepository.replaceDelivery(db, id, { mode: DeliveryMode.Flat, flatFeeCents: 700, zones: [] });

    settings = await StoreRepository.getSettings(db, id);

    deepEqual(settings?.delivery, { mode: DeliveryMode.Flat, flatFeeCents: 700, zones: [] });
  });

  it('reads the settings of one store only', async () => {
    const { id } = await StoreRepository.create(db, { name: 'S', slug: `s-${randomUUID()}`, llmModel: 'test/model' });
    const other = await StoreRepository.create(db, { name: 'O', slug: `o-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.replaceHours(db, other.id, [{ weekday: 1, opens_at: '18:00', closes_at: '23:00' }]);
    await StoreRepository.replaceDelivery(db, other.id, {
      mode: DeliveryMode.ByZone,
      flatFeeCents: 0,
      zones: [{ neighborhood: 'Centro', feeCents: 500 }]
    });

    await StoreRepository.replaceHours(db, id, [
      { weekday: 5, opens_at: '18:00', closes_at: '02:00' },
      { weekday: 0, opens_at: '11:00', closes_at: '15:00' }
    ]);
    await StoreRepository.setPaymentMethods(db, id, [PaymentMethod.Pix]);
    await StoreRepository.updatePolicy(db, id, { min_order_cents: 3000 });

    deepEqual(await StoreRepository.getSettings(db, id), {
      hours: [
        { weekday: 0, opens_at: '11:00', closes_at: '15:00' },
        { weekday: 5, opens_at: '18:00', closes_at: '02:00' }
      ],
      delivery: { mode: DeliveryMode.Flat, flatFeeCents: 0, zones: [] },
      paymentMethods: [PaymentMethod.Pix],
      policy: { min_order_cents: 3000 }
    });
  });

  it('updates the store name and the accepting-orders switch', async () => {
    const { id } = await StoreRepository.create(db, { name: 'N', slug: `n-${randomUUID()}`, llmModel: 'test/model' });

    await StoreRepository.updateStore(db, id, { name: 'Nova', acceptingOrders: true });
    await StoreRepository.updateStore(db, id, { acceptingOrders: false });

    const store = await db.stores.findOne({ select: { name: true, accepting_orders: true }, where: { id } });

    deepEqual(store, { name: 'Nova', accepting_orders: false });
  });

  it('reads the WhatsApp instance with its secret', async () => {
    const { id, whatsappWebhookSecret } = await StoreRepository.create(db, {
      name: 'W',
      slug: `w-${randomUUID()}`,
      llmModel: 'test/model'
    });

    deepEqual(await StoreRepository.getWhatsAppInstance(db, id), {
      instance: null,
      token: null,
      webhookSecret: whatsappWebhookSecret
    });

    await StoreRepository.setWhatsAppInstance(db, id, { instance: `atd_${id}`, token: 'tok' });

    deepEqual(await StoreRepository.getWhatsAppInstance(db, id), {
      instance: `atd_${id}`,
      token: 'tok',
      webhookSecret: whatsappWebhookSecret
    });

    equal(await StoreRepository.getWhatsAppInstance(db, randomUUID()), undefined);
  });

  it('merges policy patches, keeping null as "no limit"', async () => {
    const { id } = await StoreRepository.create(db, { name: 'P', slug: `p-${randomUUID()}`, llmModel: 'test/model' });

    deepEqual(await StoreRepository.getPolicy(db, id), {});

    await StoreRepository.updatePolicy(db, id, { max_item_qty: 10, sop: 'Sem troco acima de R$ 50.' });

    const policy = await StoreRepository.updatePolicy(db, id, { max_item_qty: null, min_order_cents: 3000 });

    deepEqual(policy, { max_item_qty: null, sop: 'Sem troco acima de R$ 50.', min_order_cents: 3000 });
    deepEqual(await StoreRepository.getPolicy(db, id), policy);
  });

  it('creates a panel store inactive, linked to the org, with the risk acceptance time', async () => {
    const orgId = `org_${randomUUID()}`;
    const riskAcceptedAt = new Date().toISOString();

    const { id } = await StoreRepository.create(db, {
      name: 'Org',
      slug: `org-${randomUUID()}`,
      llmModel: 'test/model',
      clerkOrgId: orgId,
      riskAcceptedAt
    });

    const store = await db.stores.findOne({
      select: { active: true, clerk_org_id: true, risk_accepted_at: true },
      where: { id }
    });

    equal(store?.active, false);
    equal(store?.clerk_org_id, orgId);
    equal(Date.parse(store?.risk_accepted_at ?? ''), Date.parse(riskAcceptedAt));
  });

  it('finds a store by its Clerk org id', async () => {
    const orgId = `org_${randomUUID()}`;
    const slug = `f-${randomUUID()}`;
    const { id } = await StoreRepository.create(db, { name: 'F', slug, llmModel: 'test/model', clerkOrgId: orgId });

    deepEqual(await StoreRepository.findByOrgId(db, orgId), {
      id,
      name: 'F',
      slug,
      active: false,
      accepting_orders: false,
      timezone: 'America/Sao_Paulo'
    });
    equal(await StoreRepository.findByOrgId(db, `org_${randomUUID()}`), undefined);
  });

  it('lists stores for the admin with inactive ones first, newest first', async () => {
    const create = async (name: string, active: boolean) => {
      const { id } = await StoreRepository.create(db, {
        name,
        slug: `l-${randomUUID()}`,
        llmModel: 'test/model',
        active
      });

      return id;
    };

    const oldInactive = await create('L1', false);
    const active = await create('L2', true);
    const newInactive = await create('L3', false);

    const ids = (await StoreRepository.listForAdmin(db)).map(({ id }) => id);
    const positions = [newInactive, oldInactive, active].map((id) => ids.indexOf(id));

    deepEqual(
      positions,
      [...positions].sort((a, b) => a - b)
    );
    ok(positions.every((position) => position >= 0));
  });

  it('activates a store and returns undefined for an unknown id', async () => {
    const { id } = await StoreRepository.create(db, { name: 'S', slug: `s-${randomUUID()}`, llmModel: 'test/model' });

    equal((await StoreRepository.setActive(db, id, true))?.active, true);
    equal(await StoreRepository.setActive(db, randomUUID(), true), undefined);
  });
});
