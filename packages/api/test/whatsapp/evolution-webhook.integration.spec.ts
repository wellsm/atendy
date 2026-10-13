import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { InboundEventKind } from '../../src/conversations/queues/inbound';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { evolutionWebhookHandler } from '../../src/whatsapp/endpoints/evolution-webhook';
import { evolutionTextEvent, seedStore } from '../support/fixtures';

describe('evolution webhook', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const call = async (input: { storeId: string; secret?: string; body: unknown }) => {
    const inboundQueue = QueueTester.getClientMock('InboundQueue');

    const response = await evolutionWebhookHandler(
      {
        parameters: { storeId: input.storeId },
        headers: { authorization: input.secret },
        body: input.body
      } as never,
      { db, inboundQueue }
    );

    return { response, inboundQueue };
  };

  it('stores a customer message, creates customer and conversation, and enqueues it', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    const { response, inboundQueue } = await call({
      storeId,
      secret,
      body: evolutionTextEvent({ instance, id: 'M1', text: 'oi' })
    });

    equal(response.status, 200);
    equal(inboundQueue.sendMessage.mock.callCount(), 1);

    const [event] = inboundQueue.sendMessage.mock.calls[0]!.arguments as [Record<string, unknown>];

    equal(event.kind, InboundEventKind.Customer);
    equal(event.eventId, 'M1');

    const message = await db.messages.findOne({
      select: { body: true, author: true, conversation_id: true },
      where: { store_id: storeId, provider_message_id: 'M1' }
    });

    equal(message?.body, 'oi');
    equal(message?.author, MessageAuthor.Customer);
    equal(event.conversationId, message?.conversation_id);

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: message.conversation_id }
    });

    equal(conversation?.mode, ConversationMode.Bot);
  });

  it('reuses the conversation for the next message of the same customer', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'A1' }) });
    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'A2' }) });

    equal(await db.conversations.count({ where: { store_id: storeId } }), 1);
    equal(await db.messages.count({ where: { store_id: storeId } }), 2);
  });

  it('stores a redelivered message once and re-enqueues it only while it is unprocessed', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    const body = evolutionTextEvent({ instance, id: 'DUP' });

    await call({ storeId, secret, body });

    // First enqueue may have failed after the insert: redelivery must enqueue again (same eventId, SQS dedupes).
    const retried = await call({ storeId, secret, body });

    equal(retried.response.status, 200);
    equal(retried.inboundQueue.sendMessage.mock.callCount(), 1);
    equal((retried.inboundQueue.sendMessage.mock.calls[0]!.arguments[0] as { eventId: string }).eventId, 'DUP');
    equal(await db.messages.count({ where: { store_id: storeId, provider_message_id: 'DUP' } }), 1);

    await db.messages.updateMany({
      data: { processed_at: new Date().toISOString() },
      where: { store_id: storeId, provider_message_id: 'DUP' }
    });

    const late = await call({ storeId, secret, body });

    equal(late.inboundQueue.sendMessage.mock.callCount(), 0);
  });

  it('rejects a wrong or missing secret without storing anything', async () => {
    const { storeId, instance } = await seedStore(db);

    const body = evolutionTextEvent({ instance, id: 'X1' });

    await rejects(call({ storeId, secret: 'wrong', body }), HttpUnauthorizedError);
    await rejects(call({ storeId, body }), HttpUnauthorizedError);

    equal(await db.messages.count({ where: { store_id: storeId } }), 0);
  });

  it('rejects an unknown store and an instance that belongs to another store', async () => {
    const { storeId, secret } = await seedStore(db);

    await rejects(
      call({ storeId: '00000000-0000-4000-8000-000000000000', secret, body: evolutionTextEvent() }),
      HttpUnauthorizedError
    );
    await rejects(
      call({ storeId, secret, body: evolutionTextEvent({ instance: 'atd_other' }) }),
      HttpUnauthorizedError
    );
  });

  it('enqueues an echo for fromMe messages of a known conversation without storing them', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'C1' }) });

    const { inboundQueue } = await call({
      storeId,
      secret,
      body: evolutionTextEvent({ instance, id: 'S1', fromMe: true, text: 'Oi, aqui é o João' })
    });

    const [event] = inboundQueue.sendMessage.mock.calls[0]!.arguments as [Record<string, unknown>];

    deepEqual(
      { kind: event.kind, eventId: event.eventId, body: event.body },
      { kind: InboundEventKind.Echo, eventId: 'S1', body: 'Oi, aqui é o João' }
    );
    equal(await db.messages.count({ where: { store_id: storeId, provider_message_id: 'S1' } }), 0);
  });

  it('ignores fromMe messages to someone who never wrote, and non-message events', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    const first = await call({ storeId, secret, body: evolutionTextEvent({ instance, fromMe: true }) });
    const second = await call({ storeId, secret, body: { event: 'connection.update', instance, data: {} } });

    equal(first.inboundQueue.sendMessage.mock.callCount(), 0);
    equal(second.response.status, 200);
  });
  it('finds the conversation by phone when staff replies to a contact now addressed by @lid', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'L1' }) });

    const { inboundQueue } = await call({
      storeId,
      secret,
      body: evolutionTextEvent({
        instance,
        id: 'LS1',
        fromMe: true,
        remoteJid: '123456789012345@lid',
        remoteJidAlt: '5511999998888@s.whatsapp.net'
      })
    });

    equal(inboundQueue.sendMessage.mock.callCount(), 1);
  });

  it('drops every event of an inactive store: nothing stored, nothing queued', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    // The customer already wrote, so a staff echo (`fromMe`) would be queued if the store were still active.
    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'ON-1', text: 'oi' }) });
    await db.stores.updateOne({ data: { active: false }, where: { id: storeId } });

    for (const fromMe of [false, true]) {
      const { response, inboundQueue } = await call({
        storeId,
        secret,
        body: evolutionTextEvent({ instance, id: `OFF-${fromMe}`, fromMe, text: 'oi' })
      });

      equal(response.status, 200);
      equal(inboundQueue.sendMessage.mock.callCount(), 0);
    }

    equal(await db.messages.count({ where: { store_id: storeId } }), 1);
  });
});
