import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpConflictError, HttpError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { connectWhatsAppHandler } from '../../src/panel/endpoints/connect-whatsapp';
import { disconnectWhatsAppHandler } from '../../src/panel/endpoints/disconnect-whatsapp';
import { getWhatsAppHandler } from '../../src/panel/endpoints/get-whatsapp';
import { WhatsAppState } from '../../src/panel/whatsapp';
import { StoreRepository } from '../../src/stores/repository';
import { seedStore } from '../support/fixtures';

type Call = { url: string; method: string; apikey?: string; body?: Record<string, unknown> };

describe('panel WhatsApp endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'http://evo';
    process.env.EVOLUTION_API_KEY = 'global-key';
    process.env.WEBHOOK_BASE_URL = 'http://api.test/base';
  });

  afterEach(() => mock.restoreAll());

  /**
   * Answers Evolution by path prefix; records every call.
   */
  const evolution = (routes: Record<string, [number, unknown]>) => {
    const calls: Call[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      const path = url.replace('http://evo', '');
      const headers = init.headers as Record<string, string>;

      calls.push({
        url: path,
        method: init.method ?? 'GET',
        apikey: headers.apikey,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
      });

      const match = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
      const [status, body] = match?.[1] ?? [500, {}];

      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    });

    return calls;
  };

  const setup = async (withInstance = true) => {
    const orgId = `org_${randomUUID()}`;
    const { storeId, secret } = await seedStore(db);

    await db.stores.updateOne({
      data: {
        clerk_org_id: orgId,
        ...(!withInstance && { whatsapp_instance: null, whatsapp_instance_token: null })
      },
      where: { id: storeId }
    });

    return { storeId, secret, identity: { userId: 'user_1', orgId } };
  };

  const state = (identity: object) => getWhatsAppHandler({ identity } as never, { db });
  const connect = (identity: object) => connectWhatsAppHandler({ identity } as never, { db });
  const disconnect = (identity: object) => disconnectWhatsAppHandler({ identity } as never, { db });

  it('reports not_created without calling Evolution when the store has no instance', async () => {
    const { identity } = await setup(false);
    const calls = evolution({});

    equal((await state(identity)).body.state, WhatsAppState.NotCreated);
    equal(calls.length, 0);
  });

  it('maps the Evolution state', async () => {
    const { identity } = await setup();

    evolution({ '/instance/connectionState/': [200, { instance: { state: 'open' } }] });
    equal((await state(identity)).body.state, WhatsAppState.Connected);

    mock.restoreAll();
    evolution({ '/instance/connectionState/': [200, { instance: { state: 'connecting' } }] });
    equal((await state(identity)).body.state, WhatsAppState.Connecting);

    mock.restoreAll();
    evolution({ '/instance/connectionState/': [200, { instance: { state: 'close' } }] });
    equal((await state(identity)).body.state, WhatsAppState.Disconnected);

    mock.restoreAll();
    evolution({ '/instance/connectionState/': [404, { message: 'not found' }] });
    equal((await state(identity)).body.state, WhatsAppState.NotCreated);

    mock.restoreAll();
    evolution({ '/instance/connectionState/': [500, {}] });
    await rejects(state(identity), (error: unknown) => error instanceof HttpError && error.status === 502);
  });

  it('creates the instance with the store webhook, then returns the QR', async () => {
    const { identity, storeId, secret } = await setup(false);

    const calls = evolution({
      '/instance/delete/': [404, {}],
      '/instance/create': [201, {}],
      '/instance/connect/': [200, { base64: 'data:image/png;base64,QR', pairingCode: 'ABCD1234' }]
    });

    const response = await connect(identity);

    deepEqual(response.body, { qrBase64: 'data:image/png;base64,QR', pairingCode: 'ABCD1234' });
    ok(!JSON.stringify(response.body).includes('global-key'));

    const create = calls.find(({ url }) => url === '/instance/create');
    const webhook = create?.body?.webhook as { url: string; headers: { authorization: string } };

    equal(create?.apikey, 'global-key');
    equal(create?.body?.instanceName, `atd_${storeId}`);
    equal(webhook.url, `http://api.test/base/webhooks/whatsapp/${storeId}`);
    equal(webhook.headers.authorization, secret);

    const stored = await StoreRepository.getWhatsAppInstance(db, storeId);

    equal(stored?.instance, `atd_${storeId}`);
    equal(stored?.token, create?.body?.token);
  });

  it('only asks for a new QR when the instance exists and is disconnected', async () => {
    const { identity, storeId } = await setup();

    const calls = evolution({
      '/instance/connectionState/': [200, { instance: { state: 'close' } }],
      '/instance/connect/': [200, { qrcode: { base64: 'data:image/png;base64,QR2' } }]
    });

    deepEqual((await connect(identity)).body, { qrBase64: 'data:image/png;base64,QR2', pairingCode: null });
    equal(
      calls.some(({ url }) => url.startsWith('/instance/create')),
      false
    );
    equal((await StoreRepository.getWhatsAppInstance(db, storeId))?.token, 'instance-token');
  });

  it('recreates an instance that Evolution no longer has', async () => {
    const { identity } = await setup();

    const calls = evolution({
      '/instance/connectionState/': [404, {}],
      '/instance/delete/': [404, {}],
      '/instance/create': [201, {}],
      '/instance/connect/': [200, { base64: 'data:image/png;base64,QR3' }]
    });

    equal((await connect(identity)).body.qrBase64, 'data:image/png;base64,QR3');
    ok(calls.some(({ url }) => url === '/instance/create'));
  });

  it('refuses to connect a linked number and reports Evolution failures as 502', async () => {
    const { identity } = await setup();

    evolution({ '/instance/connectionState/': [200, { instance: { state: 'open' } }] });
    await rejects(connect(identity), HttpConflictError);

    mock.restoreAll();
    evolution({
      '/instance/connectionState/': [200, { instance: { state: 'close' } }],
      '/instance/connect/': [503, {}]
    });
    await rejects(connect(identity), (error: unknown) => error instanceof HttpError && error.status === 502);
  });

  it('reports an unreachable or timed-out Evolution as 502', async () => {
    const { identity } = await setup();

    mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('fetch failed')));
    await rejects(state(identity), (error: unknown) => error instanceof HttpError && error.status === 502);

    mock.restoreAll();
    mock.method(globalThis, 'fetch', () =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    );
    await rejects(connect(identity), (error: unknown) => error instanceof HttpError && error.status === 502);
  });

  it('logs the number out, and refuses when there is no instance', async () => {
    const { identity, storeId } = await setup();

    const calls = evolution({
      '/instance/logout/': [200, { status: 'SUCCESS' }],
      '/instance/connectionState/': [200, { instance: { state: 'close' } }]
    });

    equal((await disconnect(identity)).body.state, WhatsAppState.Disconnected);
    ok(calls.some(({ url, method }) => url === `/instance/logout/atd_${storeId}` && method === 'DELETE'));

    const empty = await setup(false);

    await rejects(disconnect(empty.identity), HttpConflictError);
  });
});
