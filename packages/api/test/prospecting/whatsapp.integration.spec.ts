import type { Db } from '../../src/db';

import { deepEqual, equal, match, rejects } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { StoreWhatsAppError, WhatsAppState } from '../../src/panel/whatsapp';
import { PROSPECTING_EVENTS } from '../../src/prospecting/events';
import { ProspectingRepository } from '../../src/prospecting/repository';
import { ProspectingWhatsApp } from '../../src/prospecting/whatsapp';

type Body = {
  instanceName?: string;
  token?: string;
  webhook?: { url: string; headers: { authorization: string }; events: string[] };
};

type Call = { url: string; method: string; apikey?: string; body?: Body };

describe('prospecting whatsapp', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const env = {
    EVOLUTION_API_URL: 'http://evo',
    EVOLUTION_API_KEY: 'global-key',
    WEBHOOK_BASE_URL: 'http://api.test/base'
  };

  beforeEach(() => ProspectingRepository.setSenderState(db, { instance: null, token: null }));

  afterEach(() => mock.restoreAll());

  const evolution = (routes: Record<string, [number, unknown]>) => {
    const calls: Call[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      const path = url.replace('http://evo', '');
      const headers = init.headers as Record<string, string>;

      calls.push({
        url: path,
        method: init.method ?? 'GET',
        apikey: headers.apikey,
        body: init.body ? (JSON.parse(init.body as string) as Body) : undefined
      });

      const match = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
      const [status, body] = match?.[1] ?? [500, {}];

      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    });

    return calls;
  };

  it('reports not_created without calling Evolution when there is no instance', async () => {
    const calls = evolution({});

    equal(await ProspectingWhatsApp.state(db, env), WhatsAppState.NotCreated);
    equal(calls.length, 0);
  });

  it('syncs connected from the Evolution state without touching paused', async () => {
    await ProspectingRepository.setSenderState(db, {
      instance: 'atd_prospecting_00000000',
      token: 't',
      connected: false,
      paused: true
    });

    evolution({ '/instance/connectionState': [200, { instance: { state: 'open' } }] });

    equal(await ProspectingWhatsApp.state(db, env), WhatsAppState.Connected);
    equal((await ProspectingRepository.getSender(db)).connected, true);
    equal((await ProspectingRepository.getSender(db)).paused, true);

    mock.restoreAll();
    evolution({ '/instance/connectionState': [200, { instance: { state: 'close' } }] });

    equal(await ProspectingWhatsApp.state(db, env), WhatsAppState.Disconnected);
    equal((await ProspectingRepository.getSender(db)).connected, false);

    await ProspectingRepository.setSenderState(db, { connected: true, paused: false });
    mock.restoreAll();
    evolution({ '/instance/connectionState': [200, { instance: { state: 'connecting' } }] });

    equal(await ProspectingWhatsApp.state(db, env), WhatsAppState.Connecting);
    equal((await ProspectingRepository.getSender(db)).connected, false);
    equal((await ProspectingRepository.getSender(db)).paused, false);
  });

  it('stores connected false after a disconnect', async () => {
    await ProspectingRepository.setSenderState(db, {
      instance: 'atd_prospecting_00000000',
      token: 't',
      connected: true
    });

    evolution({
      '/instance/logout': [200, {}],
      '/instance/connectionState': [200, { instance: { state: 'close' } }]
    });

    equal(await ProspectingWhatsApp.disconnect(db, env), WhatsAppState.Disconnected);
    equal((await ProspectingRepository.getSender(db)).connected, false);
  });

  it('creates the instance on the first connect with the prospecting events and stores it', async () => {
    const calls = evolution({
      '/instance/delete': [404, {}],
      '/instance/create': [201, {}],
      '/instance/connect': [200, { base64: 'qr', pairingCode: 'AB12' }]
    });

    const result = await ProspectingWhatsApp.connect(db, env);
    const sender = await ProspectingRepository.getSender(db);
    const create = calls.find((call) => call.url === '/instance/create');

    deepEqual(result, { qrBase64: 'qr', pairingCode: 'AB12' });
    match(create?.body?.instanceName ?? '', /^atd_prospecting_[0-9a-f]{8}$/);
    equal(create?.body?.webhook?.url, 'http://api.test/base/webhooks/prospecting');
    equal(create?.body?.webhook?.headers.authorization, sender.webhookSecret);
    deepEqual(create?.body?.webhook?.events, PROSPECTING_EVENTS);
    equal(sender.instance, create?.body?.instanceName);
    equal(sender.token, create?.body?.token);
  });

  it('re-sets the webhook with the same events when the instance exists', async () => {
    await ProspectingRepository.setSenderState(db, { instance: 'atd_prospecting_00000000', token: 't' });

    const calls = evolution({
      '/instance/connectionState': [200, { instance: { state: 'close' } }],
      '/webhook/set': [200, {}],
      '/instance/connect': [200, { base64: 'qr' }]
    });

    await ProspectingWhatsApp.connect(db, env);

    const set = calls.find((call) => call.url.startsWith('/webhook/set/atd_prospecting_00000000'));

    deepEqual(set?.body?.webhook?.events, PROSPECTING_EVENTS);
    equal(
      calls.some((call) => call.url === '/instance/create'),
      false
    );
  });

  it('refuses to connect a linked number and to disconnect a never-created one', async () => {
    await rejects(ProspectingWhatsApp.disconnect(db, env), StoreWhatsAppError);

    await ProspectingRepository.setSenderState(db, { instance: 'atd_prospecting_00000000', token: 't' });
    evolution({ '/instance/connectionState': [200, { instance: { state: 'open' } }] });

    await rejects(ProspectingWhatsApp.connect(db, env), StoreWhatsAppError);
  });
});
