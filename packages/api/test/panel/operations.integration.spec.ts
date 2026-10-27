import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { PanelOrderScope } from '../../src/orders/repository';
import { OrderStatus } from '../../src/orders/types';
import { approveConversationHandler } from '../../src/panel/endpoints/approve-conversation';
import { getConversationHandler } from '../../src/panel/endpoints/get-conversation';
import { listConversationsHandler } from '../../src/panel/endpoints/list-conversations';
import { listOrdersHandler } from '../../src/panel/endpoints/list-orders';
import { sendMessageHandler } from '../../src/panel/endpoints/send-message';
import { updateConversationHandler } from '../../src/panel/endpoints/update-conversation';
import { updateOrderHandler } from '../../src/panel/endpoints/update-order';
import { EvolutionRequestError } from '../../src/whatsapp/evolution-client';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { placeOrder, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('panel operations endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  // Ez4 restores client mocks after each test: take a fresh one per test.
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  afterEach(() => mock.restoreAll());

  let sentCounter = 0;

  const stubProvider = (fail?: Error) => {
    const sent: { to: string; text: string }[] = [];

    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: (input: { to: string; text: string }) => {
        if (fail) {
          return Promise.reject(fail);
        }

        sent.push(input);

        return Promise.resolve({ providerMessageId: `PANEL-SEND-${++sentCounter}` });
      }
    }));

    return sent;
  };

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);
    const orderId = await placeOrder(db, { storeId, conversationId, customerId }, menu);

    return { orgId, storeId, conversationId, orderId, identity: { userId: 'user_1', orgId } };
  };

  const staffRows = async (conversationId: string) => {
    const { records } = await db.messages.findMany({
      select: { body: true, provider_message_id: true },
      where: { conversation_id: conversationId, author: MessageAuthor.Staff }
    });

    return records;
  };

  // Every change here tells the store's open panels (`notifyPanel`).
  const lastPanelEvent = (): unknown => panelEvents.sendMessage.mock.calls.at(-1)?.arguments[0];

  const updateOrder = (identity: object, orderId: string, status: OrderStatus) =>
    updateOrderHandler({ identity, parameters: { orderId }, body: { status } } as never, { db, panelEvents });

  it('lists the open orders of the token org only', async () => {
    const { identity, orderId } = await setup();
    const other = await setup();

    const response = await listOrdersHandler({ identity, query: {} } as never, { db });

    deepEqual(
      response.body.orders.map(({ id }) => id),
      [orderId]
    );

    equal(response.body.orders[0]!.items[0]!.name, 'Coca-Cola 2L');
    equal(response.body.orders[0]!.status, OrderStatus.Placed);

    const closed = await listOrdersHandler(
      { identity: other.identity, query: { scope: PanelOrderScope.Closed } } as never,
      {
        db
      }
    );

    deepEqual(closed.body.orders, []);
  });

  it('accepts an order and tells the customer as staff', async () => {
    const { identity, orderId, conversationId, storeId } = await setup();
    const sent = stubProvider();

    const response = await updateOrder(identity, orderId, OrderStatus.Accepted);

    equal(response.body.order.status, OrderStatus.Accepted);
    equal(response.body.notified, true);
    deepEqual(
      sent.map(({ text }) => text),
      [`✅ Pedido #${response.body.order.code} aceito! Já está sendo preparado 👨‍🍳`]
    );

    const rows = await staffRows(conversationId);

    equal(rows.length, 1);
    ok(rows[0]!.provider_message_id.startsWith('PANEL-SEND-'));

    deepEqual(lastPanelEvent(), { storeId, triggers: ['orders', 'conversations'], conversationId });
  });

  it('keeps the status when the notification fails, and sends nothing on done', async () => {
    const { identity, orderId, conversationId } = await setup();

    stubProvider(new EvolutionRequestError('down', 500, false));

    const accepted = await updateOrder(identity, orderId, OrderStatus.Accepted);

    equal(accepted.body.order.status, OrderStatus.Accepted);
    equal(accepted.body.notified, false);
    deepEqual(await staffRows(conversationId), []);

    mock.restoreAll();
    const sent = stubProvider();

    await updateOrder(identity, orderId, OrderStatus.Out);
    sent.length = 0;

    const done = await updateOrder(identity, orderId, OrderStatus.Done);

    equal(done.body.notified, false);
    equal(sent.length, 0);
  });

  it('answers 409 to an invalid move and 404 to another store order', async () => {
    const { identity, orderId } = await setup();
    const other = await setup();
    stubProvider();

    await rejects(updateOrder(identity, orderId, OrderStatus.Done), HttpConflictError);
    await rejects(updateOrder(other.identity, orderId, OrderStatus.Accepted), HttpNotFoundError);
    await rejects(updateOrder({ userId: 'user_1' }, orderId, OrderStatus.Accepted), HttpNotFoundError);
  });

  it('lists conversations and opens one with its messages', async () => {
    const { identity, conversationId } = await setup();
    const other = await setup();

    const list = await listConversationsHandler({ identity } as never, { db });

    deepEqual(
      list.body.conversations.map(({ id }) => id),
      [conversationId]
    );
    deepEqual(list.body.conversations[0]?.lastMessage, { author: MessageAuthor.Customer, body: 'oi' });

    const voiceNotes = { getReadUrl: (key: string) => Promise.resolve(`http://bucket/${key}`) } as never;

    await db.messages.updateMany({
      data: { reaction: '👍', audio_key: 'voice-notes/s/m' },
      where: { conversation_id: conversationId }
    });

    const thread = await getConversationHandler({ identity, parameters: { conversationId } } as never, {
      db,
      voiceNotes
    });

    equal(thread.body.conversation.mode, ConversationMode.Bot);
    deepEqual(
      thread.body.messages.map(({ body, reaction, audioUrl }) => [body, reaction, audioUrl]),
      [['oi', '👍', 'http://bucket/voice-notes/s/m']]
    );

    await rejects(
      getConversationHandler({ identity: other.identity, parameters: { conversationId } } as never, { db, voiceNotes }),
      HttpNotFoundError
    );
  });

  it('takes over and gives back to the bot, which answers what nobody answered', async () => {
    const { identity, conversationId, storeId } = await setup();
    const queued: Record<string, unknown>[] = [];
    const inboundQueue = { sendMessage: (event: Record<string, unknown>) => (queued.push(event), Promise.resolve()) };

    const update = (mode: ConversationMode) =>
      updateConversationHandler(
        { identity, parameters: { conversationId }, body: { mode } } as never,
        {
          db,
          inboundQueue,
          panelEvents
        } as never
      );

    const human = await update(ConversationMode.Human);

    equal(human.body.conversation.mode, ConversationMode.Human);
    equal(human.body.conversation.handoffReason, 'staff_took_over');
    equal(queued.length, 0);

    const bot = await update(ConversationMode.Bot);

    equal(bot.body.conversation.mode, ConversationMode.Bot);
    equal(bot.body.conversation.handoffReason, null);

    // The customer's "oi" was never answered: it is pending again and queued.
    const pending = await ConversationRepository.pendingInbound(db, conversationId);

    deepEqual(
      pending.map(({ body }) => body),
      ['oi']
    );
    deepEqual(
      queued.map(({ messageId, kind }) => ({ messageId, kind })),
      [{ messageId: pending[0]!.id, kind: 'customer' }]
    );
    deepEqual(lastPanelEvent(), { storeId, triggers: ['conversations'], conversationId });
  });

  it('approves what the bot asked and queues the waiting messages', async () => {
    const { identity, conversationId, storeId } = await setup();
    const queued: Record<string, unknown>[] = [];
    const inboundQueue = { sendMessage: (event: Record<string, unknown>) => (queued.push(event), Promise.resolve()) };
    const approve = () =>
      approveConversationHandler(
        { identity, parameters: { conversationId } } as never,
        { db, inboundQueue, panelEvents } as never
      );

    await rejects(approve(), HttpConflictError);

    await ConversationRepository.requestApproval(db, { conversationId, reason: 'order_limit' });

    const listed = await listConversationsHandler({ identity } as never, { db });

    equal(listed.body.conversations[0]?.approvalReason, 'order_limit');

    const response = await approve();

    equal(response.body.conversation.approvalReason, null);
    equal(queued.length, 1);
    deepEqual(lastPanelEvent(), { storeId, triggers: ['conversations'], conversationId });

    const conversation = await db.conversations.findOne({
      select: { approval_reason: true, approved_reason: true },
      where: { id: conversationId }
    });

    deepEqual(conversation, { approval_reason: null, approved_reason: 'order_limit' });
  });

  it('taking over a conversation waiting for approval keeps the reason', async () => {
    const { identity, conversationId } = await setup();

    await ConversationRepository.requestApproval(db, { conversationId, reason: 'suspected_prank' });

    const human = await updateConversationHandler(
      { identity, parameters: { conversationId }, body: { mode: ConversationMode.Human } } as never,
      { db, inboundQueue: { sendMessage: () => Promise.resolve() } } as never
    );

    equal(human.body.conversation.handoffReason, 'suspected_prank');
    equal(human.body.conversation.approvalReason, null);
  });

  it('replies from the panel: takes over, sends and stores the staff message', async () => {
    const { identity, conversationId, storeId } = await setup();
    const sent = stubProvider();

    const send = (text: string) =>
      sendMessageHandler({ identity, parameters: { conversationId }, body: { text } } as never, { db, panelEvents });

    const response = await send('  Já já sai!  ');

    equal(response.status, 201);
    equal(response.body.conversation.mode, ConversationMode.Human);
    equal(response.body.conversation.handoffReason, 'staff_replied_from_panel');
    deepEqual(
      sent.map(({ text }) => text),
      ['Já já sai!']
    );
    deepEqual(
      (await staffRows(conversationId)).map(({ body }) => body),
      ['Já já sai!']
    );
    deepEqual(lastPanelEvent(), { storeId, triggers: ['conversations'], conversationId });

    await rejects(send('   '), HttpBadRequestError);
  });

  it('answers 409 and stores nothing when WhatsApp rejects the reply', async () => {
    const { identity, conversationId } = await setup();
    stubProvider(new EvolutionRequestError('rejected', 400, true));

    await rejects(
      sendMessageHandler({ identity, parameters: { conversationId }, body: { text: 'Oi' } } as never, {
        db,
        panelEvents
      }),
      HttpConflictError
    );

    deepEqual(await staffRows(conversationId), []);
  });

  it('answers 409 when the store WhatsApp is not connected', async () => {
    const { identity, conversationId, storeId } = await setup();

    await db.stores.updateOne({ data: { whatsapp_instance: null }, where: { id: storeId } });

    await rejects(
      sendMessageHandler({ identity, parameters: { conversationId }, body: { text: 'Oi' } } as never, {
        db,
        panelEvents
      }),
      HttpConflictError
    );

    deepEqual(await staffRows(conversationId), []);
  });
});
