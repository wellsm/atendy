import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { notifyAdmin } from '../../src/admin/telegram';

describe('notifyAdmin', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_CHAT_ID = '42';
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('sends the text to the admin chat through the Bot API', async () => {
    const fetch = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', { status: 200 })));

    await notifyAdmin('Nova loja');

    equal(fetch.mock.callCount(), 1);

    const [url, init] = fetch.mock.calls[0]!.arguments as [string, RequestInit];

    equal(url, 'https://api.telegram.org/botbot-token/sendMessage');
    equal(init.method, 'POST');
    deepEqual(JSON.parse(init.body as string), { chat_id: '42', text: 'Nova loja' });
  });

  it('does nothing when Telegram is not configured', async () => {
    delete process.env.TELEGRAM_CHAT_ID;

    const fetch = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));

    await notifyAdmin('Nova loja');

    equal(fetch.mock.callCount(), 0);
  });

  it('never throws when Telegram fails or answers with an error', async () => {
    mock.method(globalThis, 'fetch', () => Promise.reject(new Error('network down')));

    await notifyAdmin('Nova loja');

    mock.restoreAll();
    mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', { status: 500 })));

    await notifyAdmin('Nova loja');
  });
});
