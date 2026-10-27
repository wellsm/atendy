import type { Db } from '../../src/db';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { runStockAlerts } from '../../src/stock/alerts';
import { StockRepository } from '../../src/stock/repository';
import { StockUnit } from '../../src/stock/types';
import { seedStore } from '../support/fixtures';

const env = { EVOLUTION_API_URL: 'https://evo.test', WEB_BASE_URL: 'https://app.test' };

// 2026-03-10 in São Paulo (UTC-3).
const at = (hour: number) => new Date(Date.UTC(2026, 2, 10, hour + 3, 5));

describe('runStockAlerts', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const mockFetch = () =>
    mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ key: { id: 'wamid' } }), { status: 200 }))
    );

  const seed = async (low = true) => {
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { stock_alert_phone: '5511999990000' }, where: { id: storeId } });

    const item = await StockRepository.createItem(db, storeId, {
      name: 'Mussarela',
      unit: StockUnit.Gram,
      barcode: null,
      minQty: 5000
    });

    await db.stock_items.updateOne({ data: { balance: low ? 1200 : 9000 }, where: { id: item.id } });

    return storeId;
  };

  const sentOn = async (storeId: string) =>
    (await db.stores.findOne({ select: { stock_alert_sent_on: true }, where: { id: storeId } }))?.stock_alert_sent_on;

  it('sends at the local alert hour, not before, and marks the day', async () => {
    const fetch = mockFetch();
    const storeId = await seed();

    deepEqual(await runStockAlerts(db, env, at(8), [storeId]), { sent: [] });
    equal(fetch.mock.callCount(), 0);

    deepEqual(await runStockAlerts(db, env, at(9), [storeId]), { sent: [storeId] });
    equal(fetch.mock.callCount(), 1);

    const [url, init] = fetch.mock.calls[0]!.arguments as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { number: string; text: string };

    equal(url.includes('/message/sendText/'), true);
    equal(body.number, '5511999990000');
    equal(body.text.includes('Mussarela: 1,2 kg (mín. 5 kg)'), true);
    equal(body.text.includes('/panel/t-'), true);
    equal(body.text.includes('?sheet=stock&filter=low'), true);
    equal(await sentOn(storeId), '2026-03-10');
  });

  it('sends once per day', async () => {
    const fetch = mockFetch();
    const storeId = await seed();

    await runStockAlerts(db, env, at(9), [storeId]);
    deepEqual(await runStockAlerts(db, env, at(10), [storeId]), { sent: [] });
    equal(fetch.mock.callCount(), 1);
  });

  it('catches up after a missed hour', async () => {
    const fetch = mockFetch();
    const storeId = await seed();

    deepEqual(await runStockAlerts(db, env, at(11), [storeId]), { sent: [storeId] });
    equal(fetch.mock.callCount(), 1);
  });

  it('sends nothing and keeps sent_on when no item is low', async () => {
    const fetch = mockFetch();
    const storeId = await seed(false);

    deepEqual(await runStockAlerts(db, env, at(10), [storeId]), { sent: [] });
    equal(fetch.mock.callCount(), 0);
    equal(await sentOn(storeId), null);
  });

  it('skips a store that is not connected, without marking it', async () => {
    const fetch = mockFetch();
    const storeId = await seed();

    await db.stores.updateOne({ data: { whatsapp_instance_token: null }, where: { id: storeId } });

    deepEqual(await runStockAlerts(db, env, at(10), [storeId]), { sent: [] });
    equal(fetch.mock.callCount(), 0);
    equal(await sentOn(storeId), null);
  });

  it('restores the day when Evolution answers with an error, and retries later', async () => {
    const fetch = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', { status: 400 })));
    const storeId = await seed();

    deepEqual(await runStockAlerts(db, env, at(9), [storeId]), { sent: [] });
    equal(await sentOn(storeId), null);

    fetch.mock.restore();
    const ok = mockFetch();

    deepEqual(await runStockAlerts(db, env, at(10), [storeId]), { sent: [storeId] });
    equal(ok.mock.callCount(), 1);
  });

  it('keeps the claim and tells the admin when the send fails otherwise', async () => {
    const urls: string[] = [];
    const bodies: string[] = [];

    mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
      urls.push(url);
      bodies.push(String(init?.body ?? ''));

      return url.includes('telegram') ? Promise.resolve(new Response('{}')) : Promise.reject(new Error('down'));
    });

    const storeId = await seed();

    deepEqual(await runStockAlerts(db, env, at(9), [storeId]), { sent: [] });
    equal(await sentOn(storeId), '2026-03-10');

    await runStockAlerts(db, env, at(10), [storeId]);

    equal(urls.filter((url) => url.includes('sendText')).length, 1);
    equal(urls.filter((url) => url.includes('telegram')).length, 1);
    equal(
      bodies.some((body) => body.includes('5511999990000') && body.includes('chat_id')),
      false
    );
  });

  it('keeps going with the next store after one fails', async () => {
    let calls = 0;

    mock.method(globalThis, 'fetch', () => {
      calls += 1;

      return calls === 1
        ? Promise.resolve(new Response('{}', { status: 400 }))
        : Promise.resolve(new Response(JSON.stringify({ key: { id: 'w' } }), { status: 200 }));
    });

    const first = await seed();
    const second = await seed();
    const result = await runStockAlerts(db, env, at(9), [first, second]);

    equal(result.sent.length, 1);
    equal(calls, 2);
  });

  it('sends once when two runs overlap', async () => {
    const fetch = mockFetch();
    const storeId = await seed();

    await Promise.all([runStockAlerts(db, env, at(9), [storeId]), runStockAlerts(db, env, at(9), [storeId])]);

    equal(fetch.mock.callCount(), 1);
  });

  it('skips inactive and billing-blocked stores and survives a failing send', async () => {
    const fetch = mock.method(globalThis, 'fetch', () => Promise.reject(new Error('down')));
    const inactive = await seed();
    const blocked = await seed();
    const failing = await seed();

    await db.stores.updateOne({ data: { active: false }, where: { id: inactive } });
    await db.stores.updateOne({ data: { billing_blocked: true }, where: { id: blocked } });

    deepEqual(await runStockAlerts(db, env, at(10), [inactive, blocked, failing]), { sent: [] });
    equal(fetch.mock.calls.filter((call) => String(call.arguments[0]).includes('sendText')).length, 1);
    equal(await sentOn(failing), '2026-03-10');
  });
});
