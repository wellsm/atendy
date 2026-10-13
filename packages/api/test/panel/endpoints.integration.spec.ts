import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { createStoreHandler } from '../../src/panel/endpoints/create-store';
import { getMeHandler } from '../../src/panel/endpoints/get-me';

describe('panel endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_CHAT_ID = '42';
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  const telegramOk = () => mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));

  const create = (orgId: string | undefined, body: { name: string; acceptRisk: boolean }) =>
    createStoreHandler({ identity: { userId: 'user_1', orgId }, body } as never, { db });

  const me = (orgId?: string) => getMeHandler({ identity: { userId: 'user_1', orgId } } as never, { db });

  it('creates an inactive store for the org, records the risk acceptance and pings the admin', async () => {
    const orgId = `org_${randomUUID()}`;
    const fetch = telegramOk();

    const response = await create(orgId, { name: 'Pizzaria Nova', acceptRisk: true });

    equal(response.status, 201);
    equal(response.body.store.name, 'Pizzaria Nova');
    equal(response.body.store.active, false);
    equal(response.body.store.acceptingOrders, false);

    const store = await db.stores.findOne({
      select: { clerk_org_id: true, risk_accepted_at: true },
      where: { id: response.body.store.id }
    });

    equal(store?.clerk_org_id, orgId);
    ok(store?.risk_accepted_at);

    equal(fetch.mock.callCount(), 1);

    const { text } = JSON.parse((fetch.mock.calls[0]!.arguments[1] as RequestInit).body as string) as { text: string };

    ok(text.includes('Pizzaria Nova'));
    ok(text.includes(response.body.store.id));
  });

  it('refuses a second store for the same org', async () => {
    const orgId = `org_${randomUUID()}`;
    telegramOk();

    await create(orgId, { name: 'Primeira', acceptRisk: true });

    await rejects(create(orgId, { name: 'Segunda', acceptRisk: true }), HttpConflictError);
  });

  it('requires an org and the risk acceptance', async () => {
    telegramOk();

    await rejects(create(undefined, { name: 'Sem org', acceptRisk: true }), HttpBadRequestError);
    await rejects(create(`org_${randomUUID()}`, { name: 'Sem aceite', acceptRisk: false }), HttpBadRequestError);
    await rejects(create(`org_${randomUUID()}`, { name: '   ', acceptRisk: true }), HttpBadRequestError);
    await rejects(create(`org_${randomUUID()}`, { name: ' a ', acceptRisk: true }), HttpBadRequestError);
  });

  it('still creates the store when Telegram fails', async () => {
    mock.method(globalThis, 'fetch', () => Promise.reject(new Error('network down')));

    const response = await create(`org_${randomUUID()}`, { name: 'Sem Telegram', acceptRisk: true });

    equal(response.status, 201);
  });

  it('returns the store of the org, or null during onboarding', async () => {
    const orgId = `org_${randomUUID()}`;
    telegramOk();

    deepEqual((await me()).body, { hasOrg: false, store: null });
    deepEqual((await me(orgId)).body, { hasOrg: true, store: null });

    const {
      body: { store }
    } = await create(orgId, { name: 'Minha Loja', acceptRisk: true });

    deepEqual((await me(orgId)).body, { hasOrg: true, store });
  });
});
