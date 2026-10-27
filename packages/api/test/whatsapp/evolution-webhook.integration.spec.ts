import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { InboundEventKind } from '../../src/conversations/queues/inbound';
import { ConversationMode, MessageAuthor, MessageDirection } from '../../src/conversations/types';
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

  it('shows every customer reaction on its message, but sends the bot only answers to its latest question', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'C1', text: 'oi' }) });

    const customer = await db.messages.findOne({
      select: { conversation_id: true },
      where: { store_id: storeId, provider_message_id: 'C1' }
    });

    const conversationId = customer!.conversation_id;

    const outbound = async (providerMessageId: string, author: MessageAuthor, body: string, at: string) =>
      db.messages.insertOne({
        data: {
          id: randomUUID(),
          store_id: storeId,
          conversation_id: conversationId,
          direction: MessageDirection.Out,
          author,
          body,
          provider_message_id: providerMessageId,
          created_at: at
        }
      });

    await outbound('S1', MessageAuthor.Staff, 'Seu pedido saiu para entrega!', '2026-10-19T19:00:00.000Z');
    await outbound('B1', MessageAuthor.Bot, 'Confere o resumo? Posso confirmar?', '2026-10-19T19:01:00.000Z');

    const react = (id: string, target: string, text: string, fromMe = false) =>
      call({
        storeId,
        secret,
        body: evolutionTextEvent({
          instance,
          id,
          fromMe,
          message: { reactionMessage: { key: { id: target }, text } }
        })
      });

    const reactionOf = async (providerMessageId: string) =>
      (
        await db.messages.findOne({
          select: { reaction: true },
          where: { store_id: storeId, provider_message_id: providerMessageId }
        })
      )?.reaction;

    const ignored = await react('R1', 'S1', '👍');

    equal(ignored.inboundQueue.sendMessage.mock.callCount(), 0);
    equal(await reactionOf('S1'), '👍');
    equal(await db.messages.count({ where: { store_id: storeId, provider_message_id: 'R1' } }), 0);

    // The owner answering as a customer from the alert phone is still a customer reaction.
    await db.stores.updateOne({ data: { stock_alert_phone: '5511999998888' }, where: { id: storeId } });

    const answer = await react('R2', 'B1', '👍');

    equal(answer.inboundQueue.sendMessage.mock.callCount(), 1);
    equal(await reactionOf('B1'), '👍');

    const reactionMessage = await db.messages.findOne({
      select: { body: true, author: true },
      where: { store_id: storeId, provider_message_id: 'R2' }
    });

    deepEqual(reactionMessage, {
      body: 'Reação 👍 à mensagem: Confere o resumo? Posso confirmar?',
      author: MessageAuthor.Customer
    });

    const removed = await react('R3', 'S1', '');

    equal(removed.inboundQueue.sendMessage.mock.callCount(), 0);
    equal(await reactionOf('S1'), null);

    // The store's own reaction from the phone.
    await react('R4', 'C1', '😀', true);

    equal(await reactionOf('C1'), null);
  });

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

  it('drops fromMe messages to the stock alert phone, even with a conversation, but not to other customers', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    // Customer writes first, so a conversation exists for that phone.
    await call({ storeId, secret, body: evolutionTextEvent({ instance, id: 'C1' }) });
    await db.stores.updateOne({ data: { stock_alert_phone: '5511999998888' }, where: { id: storeId } });

    const digest = await call({
      storeId,
      secret,
      body: evolutionTextEvent({ instance, id: 'D1', fromMe: true, text: 'Estoque baixo' })
    });
    const eight = await call({
      storeId,
      secret,
      body: evolutionTextEvent({
        instance,
        id: 'D2',
        fromMe: true,
        remoteJid: '551199998888@s.whatsapp.net',
        text: 'Estoque baixo'
      })
    });

    equal(digest.response.status, 200);
    equal(digest.inboundQueue.sendMessage.mock.callCount(), 0);
    equal(eight.inboundQueue.sendMessage.mock.callCount(), 0);

    await db.stores.updateOne({ data: { stock_alert_phone: '5511911112222' }, where: { id: storeId } });

    const other = await call({
      storeId,
      secret,
      body: evolutionTextEvent({ instance, id: 'S9', fromMe: true, text: 'Oi' })
    });

    equal(other.inboundQueue.sendMessage.mock.callCount(), 1);

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: {
        id: (await db.conversations.findMany({ select: { id: true }, where: { store_id: storeId }, take: 1 }))
          .records[0]!.id
      }
    });

    equal(conversation?.mode, ConversationMode.Bot);
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

  it('drops events of a store blocked by an unpaid invoice', async () => {
    const { storeId, secret, instance } = await seedStore(db);

    await db.stores.updateOne({ data: { billing_blocked: true }, where: { id: storeId } });

    const { response, inboundQueue } = await call({
      storeId,
      secret,
      body: evolutionTextEvent({ instance, id: 'BLOCKED-1', text: 'oi' })
    });

    equal(response.status, 200);
    equal(inboundQueue.sendMessage.mock.callCount(), 0);
    equal(await db.messages.count({ where: { store_id: storeId } }), 0);
  });
});
