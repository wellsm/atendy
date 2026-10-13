import type { Db } from '../../src/db';

import assert, { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { TurnError } from '../../src/agent/errors';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { TurnResponder } from '../../src/agent/turn';
import { handler, InboundEventKind } from '../../src/conversations/queues/inbound';
import { TECHNICAL_ERROR_REPLY } from '../../src/conversations/replies';
import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { EvolutionRequestError } from '../../src/whatsapp/evolution-client';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { seedStore } from '../support/fixtures';

describe('inbound queue handler', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  let sentCounter = 0;

  const stubProvider = () => {
    const sent: { to: string; text: string }[] = [];

    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: (input: { to: string; text: string }) => {
        sent.push(input);
        return Promise.resolve({ providerMessageId: `BOT-${++sentCounter}` });
      }
    }));

    return sent;
  };

  const stubTurn = (reply = 'Olá! Qual pizza você quer?') => {
    return mock.method(TurnResponder, 'respond', () => Promise.resolve({ text: reply, mutated: false }));
  };

  const receive = async (storeId: string, id: string, text: string) => {
    const ingested = await ConversationRepository.ingestCustomerMessage(db, {
      storeId,
      message: {
        kind: ParsedEventKind.Message,
        instance: 'i',
        providerMessageId: id,
        fromMe: false,
        jid: '5511999998888@s.whatsapp.net',
        phone: '5511999998888',
        text,
        sentAt: new Date().toISOString()
      }
    });

    return ingested;
  };

  const variables = {
    EVOLUTION_API_URL: 'http://evo',
    OPENROUTER_API_KEY: 'o'
  };

  const run = (event: Record<string, unknown>, attempt = 1, maxAttempts = 3) =>
    handler({ message: event, attempt, maxAttempts } as never, { db, variables });

  const customerEvent = (ingested: { conversationId: string; messageId: string }, eventId: string) => ({
    conversationId: ingested.conversationId,
    eventId,
    kind: InboundEventKind.Customer,
    messageId: ingested.messageId
  });

  it('answers a burst of messages once, with all of them in the turn', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    const turn = stubTurn();

    const first = await receive(storeId, 'B1', 'oi');
    const second = await receive(storeId, 'B2', 'quero pizza');
    const third = await receive(storeId, 'B3', 'grande');

    await run(customerEvent(first, 'B1'));
    await run(customerEvent(second, 'B2'));
    await run(customerEvent(third, 'B3'));

    equal(sent.length, 1);
    equal(turn.mock.callCount(), 1);

    const [input] = turn.mock.calls[0]!.arguments as unknown as [{ messages: { body: string }[] }];

    deepEqual(
      input.messages.map(({ body }) => body),
      ['oi', 'quero pizza', 'grande']
    );
    deepEqual(await ConversationRepository.pendingInbound(db, third.conversationId), []);
  });

  it('stores the bot reply with its provider id so the echo is recognised', async () => {
    const { storeId } = await seedStore(db);
    stubProvider();
    stubTurn();

    const ingested = await receive(storeId, 'E1', 'oi');
    await run(customerEvent(ingested, 'E1'));

    const {
      records: [reply]
    } = await db.messages.findMany({
      select: { provider_message_id: true, author: true },
      where: { conversation_id: ingested.conversationId, author: MessageAuthor.Bot },
      take: 1
    });

    equal(reply?.author, MessageAuthor.Bot);

    await run({
      conversationId: ingested.conversationId,
      eventId: reply.provider_message_id,
      kind: InboundEventKind.Echo,
      body: 'Olá! Qual pizza você quer?'
    });

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: ingested.conversationId }
    });

    equal(conversation?.mode, ConversationMode.Bot);
  });

  it('switches to human when staff types on the store phone, and stops answering', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    stubTurn();

    const ingested = await receive(storeId, 'H1', 'oi');

    await run({
      conversationId: ingested.conversationId,
      eventId: 'STAFF-1',
      kind: InboundEventKind.Echo,
      body: 'Oi, aqui é o João'
    });

    const conversation = await db.conversations.findOne({
      select: { mode: true, handoff_reason: true },
      where: { id: ingested.conversationId }
    });

    equal(conversation?.mode, ConversationMode.Human);
    equal(await db.messages.count({ where: { provider_message_id: 'STAFF-1', author: MessageAuthor.Staff } }), 1);

    await run(customerEvent(ingested, 'H1'));

    equal(sent.length, 0);
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);
  });

  it('claims the echo of a panel send that is not confirmed yet, without a handoff', async () => {
    const { storeId } = await seedStore(db);
    stubProvider();

    const ingested = await receive(storeId, 'P1', 'oi');

    await ConversationRepository.createPendingOutbound(db, {
      storeId,
      conversationId: ingested.conversationId,
      body: 'Seu pedido saiu para entrega!',
      author: MessageAuthor.Staff
    });

    await run({
      conversationId: ingested.conversationId,
      eventId: 'PANEL-1',
      kind: InboundEventKind.Echo,
      body: 'Seu pedido saiu para entrega!'
    });

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: ingested.conversationId }
    });

    equal(conversation?.mode, ConversationMode.Bot);
    equal(
      await db.messages.count({ where: { conversation_id: ingested.conversationId, author: MessageAuthor.Staff } }),
      1
    );
    equal(await db.messages.count({ where: { provider_message_id: 'PANEL-1' } }), 1);
  });

  it('still answers a customer message when a panel staff message went out during the debounce window', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    stubTurn();

    const ingested = await receive(storeId, 'D1', 'quero uma pizza');

    await ConversationRepository.recordOutbound(db, {
      storeId,
      conversationId: ingested.conversationId,
      author: MessageAuthor.Staff,
      body: 'Seu pedido saiu para entrega!',
      providerMessageId: 'PANEL-DEBOUNCE-1'
    });

    await run(customerEvent(ingested, 'D1'));

    deepEqual(
      sent.map(({ text }) => text),
      ['Olá! Qual pizza você quer?']
    );
  });

  it('sends the closed reply at most once per hour while the store is closed', async () => {
    const { storeId } = await seedStore(db, { hours: [] });
    const sent = stubProvider();
    const turn = stubTurn();

    const first = await receive(storeId, 'C1', 'oi');
    await run(customerEvent(first, 'C1'));

    const second = await receive(storeId, 'C2', 'tem alguém?');
    await run(customerEvent(second, 'C2'));

    equal(sent.length, 1);
    equal(turn.mock.callCount(), 0);
    deepEqual(await ConversationRepository.pendingInbound(db, second.conversationId), []);
  });

  it('answers "not accepting orders" when the store is open but paused', async () => {
    const { storeId } = await seedStore(db, { accepting_orders: false });
    const sent = stubProvider();

    const ingested = await receive(storeId, 'P1', 'oi');
    await run(customerEvent(ingested, 'P1'));

    equal(sent.length, 1);
    equal(sent[0]!.text.includes('não estamos aceitando pedidos'), true);
  });

  it('ignores an event whose conversation no longer exists', async () => {
    stubProvider();

    await run({
      conversationId: '00000000-0000-4000-8000-000000000000',
      eventId: 'GONE',
      kind: InboundEventKind.Customer,
      messageId: '00000000-0000-4000-8000-000000000001'
    });
  });
  const stubFlakyProvider = (firstError: Error) => {
    let calls = 0;

    mock.method(WhatsAppProviders, 'forStore', () => ({
      sendText: () => {
        calls += 1;

        return calls === 1
          ? Promise.reject(firstError)
          : Promise.resolve({ providerMessageId: `BOT-${++sentCounter}` });
      }
    }));

    return () => calls;
  };

  const botRows = async (conversationId: string) => {
    const { records } = await db.messages.findMany({
      select: { provider_message_id: true },
      where: { conversation_id: conversationId, author: MessageAuthor.Bot }
    });

    return records;
  };

  it('does not send twice when a send times out after possibly reaching WhatsApp', async () => {
    const { storeId } = await seedStore(db);
    const attempts = stubFlakyProvider(new Error('The operation was aborted due to timeout'));
    stubTurn('Qual sabor?');

    const ingested = await receive(storeId, 'T1', 'oi');

    await run(customerEvent(ingested, 'T1')).then(
      () => assert.fail('first attempt should fail'),
      () => undefined
    );
    await run(customerEvent(ingested, 'T1'));

    equal(attempts(), 1);
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);

    // The echo of that first send arrives with an id we never stored: it is ours, not staff.
    await run({
      conversationId: ingested.conversationId,
      eventId: 'EVO-T1',
      kind: InboundEventKind.Echo,
      body: 'Qual sabor?'
    });

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: ingested.conversationId }
    });

    equal(conversation?.mode, ConversationMode.Bot);
    deepEqual(
      (await botRows(ingested.conversationId)).map(({ provider_message_id }) => provider_message_id),
      ['EVO-T1']
    );
  });

  it('sends again when WhatsApp answered with an error (message not sent)', async () => {
    const { storeId } = await seedStore(db);
    const attempts = stubFlakyProvider(new EvolutionRequestError('Evolution request failed (503)', 503, false));
    stubTurn();

    const ingested = await receive(storeId, 'R1', 'oi');

    await run(customerEvent(ingested, 'R1')).then(
      () => assert.fail('first attempt should fail'),
      () => undefined
    );
    await run(customerEvent(ingested, 'R1'));

    equal(attempts(), 2);
    equal((await botRows(ingested.conversationId)).length, 1);
  });

  it('keeps the handoff when storing the staff message fails and the echo is retried', async () => {
    const { storeId } = await seedStore(db);
    stubProvider();

    const ingested = await receive(storeId, 'I2', 'oi');
    const original = ConversationRepository.recordOutbound;
    let failed = false;

    mock.method(ConversationRepository, 'recordOutbound', (...args: Parameters<typeof original>) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error('db down'));
      }

      return original(...args);
    });

    const echo = {
      conversationId: ingested.conversationId,
      eventId: 'STAFF-I2',
      kind: InboundEventKind.Echo,
      body: 'oi'
    };

    await run(echo).then(
      () => assert.fail('first attempt should fail'),
      () => undefined
    );

    const conversation = await db.conversations.findOne({
      select: { mode: true },
      where: { id: ingested.conversationId }
    });

    equal(conversation?.mode, ConversationMode.Human);

    await run(echo);

    equal(await db.messages.count({ where: { provider_message_id: 'STAFF-I2', author: MessageAuthor.Staff } }), 1);
  });

  const conversationOf = (conversationId: string) =>
    db.conversations.findOne({ select: { mode: true, handoff_reason: true }, where: { id: conversationId } });

  it('retries a failed AI turn while attempts remain, sending nothing', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    mock.method(TurnResponder, 'respond', () => Promise.reject(new TurnError('OpenRouter request failed (503)', true)));

    const ingested = await receive(storeId, 'A1', 'oi');

    await run(customerEvent(ingested, 'A1'), 1, 3).then(
      () => assert.fail('should rethrow for the queue retry'),
      () => undefined
    );

    equal(sent.length, 0);
    equal((await ConversationRepository.pendingInbound(db, ingested.conversationId)).length, 1);
    equal((await conversationOf(ingested.conversationId))?.mode, ConversationMode.Bot);
  });

  it('hands off with an apology on the last attempt', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    mock.method(TurnResponder, 'respond', () => Promise.reject(new TurnError('OpenRouter request failed (503)', true)));

    const ingested = await receive(storeId, 'A3', 'oi');

    await run(customerEvent(ingested, 'A3'), 3, 3);

    deepEqual(
      sent.map(({ text }) => text),
      [TECHNICAL_ERROR_REPLY]
    );
    equal((await conversationOf(ingested.conversationId))?.mode, ConversationMode.Human);
    equal((await conversationOf(ingested.conversationId))?.handoff_reason, 'technical_error');
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);
  });

  it('hands off instead of replaying a turn that changed the order when WhatsApp rejects the reply', async () => {
    const { storeId } = await seedStore(db);
    const attempts = stubFlakyProvider(new EvolutionRequestError('Evolution request failed (503)', 503, false));
    const turn = mock.method(TurnResponder, 'respond', () =>
      Promise.resolve({ text: 'Anotei a coca!', mutated: true })
    );

    const ingested = await receive(storeId, 'S1', 'uma coca');

    await run(customerEvent(ingested, 'S1'));

    equal(attempts(), 1);
    equal(turn.mock.callCount(), 1);
    equal((await conversationOf(ingested.conversationId))?.mode, ConversationMode.Human);
    equal((await conversationOf(ingested.conversationId))?.handoff_reason, 'send_failed');
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);
  });

  it('hands off at once when the failed turn already changed the order', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    mock.method(TurnResponder, 'respond', () => Promise.reject(new TurnError('Tool round limit reached', false)));

    const ingested = await receive(storeId, 'M1', 'oi');

    await run(customerEvent(ingested, 'M1'), 1, 3);

    equal(sent[0]?.text, TECHNICAL_ERROR_REPLY);
    equal((await conversationOf(ingested.conversationId))?.mode, ConversationMode.Human);
  });

  it('answers a real turn through the LLM agent', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();

    mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content: 'Olá! O que vai ser hoje?' },
        usage: { inputTokens: 100, outputTokens: 8, costUsd: 0.00003 },
        latencyMs: 40
      })
    );

    const ingested = await receive(storeId, 'L1', 'oi');

    await run(customerEvent(ingested, 'L1'));

    equal(sent[0]?.text, 'Olá! O que vai ser hoje?');
    equal(await db.ai_calls.count({ where: { conversation_id: ingested.conversationId } }), 1);
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);
  });
});
