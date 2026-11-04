import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { ClerkBackend } from '../../src/clerk/backend';
import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { getDemoThreadHandler } from '../../src/demo/endpoints/get-thread';
import { sendDemoMessageHandler } from '../../src/demo/endpoints/send-message';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { seedStore } from '../support/fixtures';

describe('demo phones', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const identity = { userId: 'user_demo' };
  const phone = '5500123456789';

  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  let queued: unknown[] = [];

  const inboundQueue = {
    sendMessage: (event: unknown) => {
      queued.push(event);
      return Promise.resolve();
    }
  } as never;

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
    queued = [];
    ClerkBackend.clearCache();
  });

  afterEach(() => {
    mock.restoreAll();
    process.env.DEMO_ENABLED = 'true';
  });

  /**
   * The demo user is a member of these orgs.
   */
  const memberOf = (...orgIds: string[]) =>
    mock.method(globalThis, 'fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: orgIds.map((id) => ({ organization: { id } })) }), { status: 200 })
      )
    );

  const demoStore = async (overrides: { active?: boolean } = {}) => {
    const { storeId } = await seedStore(db, overrides);
    const orgId = `org_${randomUUID()}`;

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });
    memberOf(orgId);

    return { storeId, slug: `t-${storeId}` };
  };

  const send = (body: Record<string, unknown>) =>
    sendDemoMessageHandler({ identity, body } as never, { db, inboundQueue, panelEvents });

  const thread = (slug: string, threadPhone = phone) =>
    getDemoThreadHandler({ identity, query: { slug, phone: threadPhone } } as never, {
      db,
      inboundQueue,
      panelEvents
    });

  const message = (slug: string, overrides: Record<string, unknown> = {}) => ({
    slug,
    phone,
    name: 'Ana',
    text: 'quero pizza',
    clientMessageId: randomUUID(),
    ...overrides
  });

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('stores the message of a fake customer and queues the bot turn', async () => {
    const { storeId, slug } = await demoStore();

    const response = await send(message(slug));

    equal(response.status, 202);
    equal(queued.length, 1);

    const customer = await db.customers.findOne({
      select: { whatsapp_jid: true, name: true },
      where: { store_id: storeId, phone }
    });

    deepEqual(customer, { whatsapp_jid: `${phone}@sim`, name: 'Ana' });

    const body = (await thread(slug)).body;

    equal(body.conversationId, response.body.conversationId);
    equal(body.typing, true);
    deepEqual(
      body.messages.map(({ author, body }) => [author, body]),
      [[MessageAuthor.Customer, 'quero pizza']]
    );
  });

  it('stores a retried send once (re-queuing the same message, like the webhook)', async () => {
    const { slug } = await demoStore();
    const first = message(slug);

    await send(first);
    await send(first);

    equal((await thread(slug)).body.messages.length, 1);
    equal(new Set(queued.map((event) => (event as { messageId: string }).messageId)).size, 1);
  });

  it('refuses a phone outside the fake range', async () => {
    const { slug } = await demoStore();

    await rejects(send(message(slug, { phone: '5598123456789' })), badField('phone'));
    await rejects(send(message(slug, { name: '  ' })), badField('name'));
    await rejects(send(message(slug, { text: '  ' })), badField('text'));
  });

  it('refuses a store the user is not a member of', async () => {
    const { storeId } = await seedStore(db);
    memberOf('org_other');

    await rejects(send(message(`t-${storeId}`)), HttpNotFoundError);
    await rejects(thread(`t-${storeId}`), HttpNotFoundError);
  });

  it('refuses an inactive store', async () => {
    const { slug } = await demoStore({ active: false });

    await rejects(send(message(slug)), HttpConflictError);
  });

  it('never takes over a real customer with the same phone', async () => {
    const { storeId, slug } = await demoStore();

    await ConversationRepository.ingestCustomerMessage(db, {
      storeId,
      message: {
        kind: ParsedEventKind.Message,
        instance: 'i',
        providerMessageId: `real-${randomUUID()}`,
        fromMe: false,
        jid: `${phone}@s.whatsapp.net`,
        phone,
        text: 'oi',
        sentAt: new Date().toISOString()
      }
    });

    await rejects(send(message(slug)), HttpConflictError);
    await rejects(thread(slug), HttpConflictError);
    equal(queued.length, 0);
  });

  it('answers 404 when the demo is turned off', async () => {
    const { slug } = await demoStore();
    process.env.DEMO_ENABLED = 'false';

    await rejects(send(message(slug)), HttpNotFoundError);
    await rejects(thread(slug), HttpNotFoundError);
  });

  it('shows an empty thread for a new phone and no typing in human mode', async () => {
    const { slug } = await demoStore();

    deepEqual((await thread(slug, '5500111111111')).body, {
      conversationId: null,
      mode: null,
      typing: false,
      messages: []
    });

    const { body } = await send(message(slug));

    await ConversationRepository.setMode(db, { conversationId: body.conversationId, mode: ConversationMode.Human });

    const human = (await thread(slug)).body;

    equal(human.mode, ConversationMode.Human);
    equal(human.typing, false);
  });
});
