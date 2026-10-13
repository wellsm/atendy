import type { EvolutionRequestError } from '../../src/whatsapp/evolution-client';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { EvolutionClient } from '../../src/whatsapp/evolution-client';

const respond = (status: number, body: unknown) =>
  mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('EvolutionClient.sendText', () => {
  afterEach(() => mock.restoreAll());

  const input = { baseUrl: 'http://evo', instance: 'atd x', token: 'tok', to: '5511@s.whatsapp.net', text: 'oi' };

  it('posts to the instance with its own token and returns the provider id', async () => {
    const fetchMock = respond(201, { key: { id: 'BAE5', remoteJid: '5511@s.whatsapp.net' }, status: 'PENDING' });

    deepEqual(await EvolutionClient.sendText(input), { providerMessageId: 'BAE5' });

    const [url, init] = fetchMock.mock.calls[0]!.arguments as unknown as [string, RequestInit];

    equal(url, 'http://evo/message/sendText/atd%20x');
    equal((init.headers as Record<string, string>).apikey, 'tok');
    deepEqual(JSON.parse(init.body as string), { number: '5511@s.whatsapp.net', text: 'oi' });
  });

  it('marks 4xx (except 429) as permanent and 5xx as transient', async () => {
    respond(400, { error: 'bad number' });
    await rejects(EvolutionClient.sendText(input), (error: EvolutionRequestError) => error.permanent === true);

    mock.restoreAll();
    respond(503, {});
    await rejects(EvolutionClient.sendText(input), (error: EvolutionRequestError) => error.permanent === false);
  });

  it('treats a success without key.id as a transient failure', async () => {
    respond(201, { status: 'PENDING' });
    await rejects(EvolutionClient.sendText(input), (error: EvolutionRequestError) => error.permanent === false);
  });
});

describe('EvolutionClient instance management', () => {
  afterEach(() => mock.restoreAll());

  const input = { baseUrl: 'http://evo', apiKey: 'global-key', instance: 'atd x' };

  it('reads the connection state with the global key', async () => {
    const fetchMock = respond(200, { instance: { instanceName: 'atd x', state: 'open' } });

    equal(await EvolutionClient.connectionState(input), 'open');

    const [url, init] = fetchMock.mock.calls[0]!.arguments as unknown as [string, RequestInit];

    equal(url, 'http://evo/instance/connectionState/atd%20x');
    equal(init.method, 'GET');
    equal((init.headers as Record<string, string>).apikey, 'global-key');
  });

  it('reports an unknown state as closed and a missing instance as a 404 error', async () => {
    respond(200, { instance: { state: 'weird' } });
    equal(await EvolutionClient.connectionState(input), 'close');

    mock.restoreAll();
    respond(404, { message: 'instance does not exist' });
    await rejects(EvolutionClient.connectionState(input), (error: EvolutionRequestError) => error.status === 404);
  });

  it('logs the instance out', async () => {
    const fetchMock = respond(200, { status: 'SUCCESS' });

    await EvolutionClient.logout(input);

    const [url, init] = fetchMock.mock.calls[0]!.arguments as unknown as [string, RequestInit];

    equal(url, 'http://evo/instance/logout/atd%20x');
    deepEqual([init.method, (init.headers as Record<string, string>).apikey], ['DELETE', 'global-key']);
  });
});
