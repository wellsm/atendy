import type { Db } from '../../src/db';

import assert, { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { TurnError } from '../../src/agent/errors';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { TurnResponder } from '../../src/agent/turn';
import { handler, InboundEventKind } from '../../src/conversations/queues/inbound';
import { TECHNICAL_ERROR_REPLY } from '../../src/conversations/replies';
import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor, MessageDirection } from '../../src/conversations/types';
import { EvolutionRequestError } from '../../src/whatsapp/evolution-client';
import { MEDIA_ONLY_REPLY } from '../../src/whatsapp/media';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { placeOrder, seedMenu, seedStore } from '../support/fixtures';

describe('inbound queue handler', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  let sentCounter = 0;

  /**
   * Records sends and the typing indicator in one timeline (`typing:start`, `typing:stop`, then the text).
   */
  const stubProvider = (
    downloadMedia = () => Promise.resolve({ base64: 'T2dn', mimetype: 'audio/ogg; codecs=opus' })
  ) => {
    const sent: { to: string; text: string; delayMs?: number }[] = [];
    const timeline: string[] = [];

    mock.method(WhatsAppProviders, 'forStore', () => ({
      downloadMedia,
      sendText: (input: { to: string; text: string; delayMs?: number }) => {
        sent.push(input);
        timeline.push(input.text);
        return Promise.resolve({ providerMessageId: `BOT-${++sentCounter}` });
      },
      startTyping: () => {
        timeline.push('typing:start');

        return () => {
          timeline.push('typing:stop');
          return Promise.resolve();
        };
      }
    }));

    return Object.assign(sent, { timeline });
  };

  const stubTurn = (reply = 'Olá! Qual pizza você quer?') => {
    return mock.method(TurnResponder, 'respond', () => Promise.resolve({ text: reply, mutated: false }));
  };

  const receive = async (storeId: string, id: string, text: string, voiceNote?: Record<string, unknown>) => {
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
        ...(voiceNote && { voiceNote }),
        sentAt: new Date().toISOString()
      }
    });

    return ingested;
  };

  const variables = {
    EVOLUTION_API_URL: 'http://evo',
    OPENROUTER_API_KEY: 'o',
    ANTHROPIC_API_KEY: 'a',
    GOOGLE_MAPS_API_KEY: 'g',
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_CHAT_ID: 'c',
    WEB_BASE_URL: 'http://web.test/'
  };

  const simulationSteps: unknown[] = [];

  const simulationQueue = {
    sendMessage: (step: unknown) => {
      simulationSteps.push(step);
      return Promise.resolve();
    }
  } as never;

  // In-memory VoiceNotes bucket.
  const savedAudio = new Map<string, Buffer>();

  const voiceNotes = {
    write: (key: string, content: Buffer) => {
      savedAudio.set(key, content);
      return Promise.resolve();
    },
    read: (key: string) => {
      const content = savedAudio.get(key);
      return content ? Promise.resolve(content) : Promise.reject(new Error(`No object ${key}`));
    }
  } as never;

  // An earlier message in the same conversation: the batch is not the first contact, so no greeting goes out.
  const returning = async (storeId: string) => {
    const { messageId } = await receive(storeId, 'PRIOR', 'oi');

    await ConversationRepository.markProcessed(db, [messageId]);
  };

  const run = (event: Record<string, unknown>, attempt = 1, maxAttempts = 3) =>
    handler({ message: event, attempt, maxAttempts } as never, { db, simulationQueue, voiceNotes, variables });

  const customerEvent = (ingested: { conversationId: string; messageId: string }, eventId: string) => ({
    conversationId: ingested.conversationId,
    eventId,
    kind: InboundEventKind.Customer,
    messageId: ingested.messageId
  });

  it('answers a burst of messages once, with all of them in the turn', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
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
    // "Digitando…" runs only while the model turn runs, and stops before the reply goes out.
    deepEqual(sent.timeline, ['typing:start', 'typing:stop', sent[0]!.text]);

    const [input] = turn.mock.calls[0]!.arguments as unknown as [{ messages: { body: string }[]; menuUrl: string }];

    equal(input.menuUrl, `http://web.test/t-${storeId}`);

    deepEqual(
      input.messages.map(({ body }) => body),
      ['oi', 'quero pizza', 'grande']
    );
    deepEqual(await ConversationRepository.pendingInbound(db, third.conversationId), []);
  });

  it('welcomes a new customer who only said hello in three messages, without a model turn', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    const turn = stubTurn();

    const ingested = await receive(storeId, 'G1', 'Olá, boa noite!');

    await run(customerEvent(ingested, 'G1'));

    equal(turn.mock.callCount(), 0);
    equal(sent.length, 3);
    assert.match(sent[0]!.text, /^(Bom dia|Boa tarde|Boa noite)! 👋$/);
    ok(sent[2]!.text.includes(`http://web.test/t-${storeId}`));
    // The first message goes right away; the next ones show "digitando…" first.
    deepEqual(
      sent.map(({ delayMs }) => delayMs),
      [undefined, 1200, 1200]
    );
    deepEqual(await ConversationRepository.pendingInbound(db, ingested.conversationId), []);
  });

  it('greets a returning customer once, before the model reply split into messages', async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const sent = stubProvider();
    const turn = stubTurn('Anotado! 😊\n---\nComo prefere pagar?\n1️⃣ Pix\n2️⃣ Cartão');

    const first = await receive(storeId, 'R1', 'oi, quero uma coca');
    const conversation = await db.conversations.findOne({
      select: { customer_id: true },
      where: { id: first.conversationId }
    });

    await placeOrder(
      db,
      { storeId, conversationId: first.conversationId, customerId: conversation!.customer_id },
      menu
    );

    await run(customerEvent(first, 'R1'));

    const [input] = turn.mock.calls[0]!.arguments as unknown as [{ greeted: boolean }];

    equal(input.greeted, true);
    equal(sent.length, 3);
    ok(sent[0]!.text.includes('Que bom te ver de novo'));
    deepEqual(
      sent.slice(1).map(({ text }) => text),
      ['Anotado! 😊', 'Como prefere pagar?\n1️⃣ Pix\n2️⃣ Cartão']
    );

    // Same cycle: no greeting again.
    const second = await receive(storeId, 'R2', 'pix');

    await run(customerEvent(second, 'R2'));

    equal((turn.mock.calls[1]!.arguments as unknown as [{ greeted: boolean }])[0].greeted, false);
    equal(sent.length, 5);
    equal(sent[3]!.text, 'Anotado! 😊');
  });

  it('answers media without text with a fixed reply and no model turn', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
    const sent = stubProvider();
    const turn = stubTurn();

    const audio = await receive(storeId, 'M1', '🎤 Áudio');
    const sticker = await receive(storeId, 'M2', '💬 Figurinha');

    await run(customerEvent(audio, 'M1'));
    await run(customerEvent(sticker, 'M2'));

    deepEqual(
      sent.map(({ text }) => text),
      [MEDIA_ONLY_REPLY]
    );
    equal(sent.timeline.includes('typing:start'), false);
    equal(turn.mock.callCount(), 0);
    deepEqual(await ConversationRepository.pendingInbound(db, sticker.conversationId), []);

    // A caption is text the model can use.
    const photo = await receive(storeId, 'M3', '🖼️ Imagem: quero igual a essa');

    await run(customerEvent(photo, 'M3'));

    equal(turn.mock.callCount(), 1);
  });

  it('transcribes voice notes before the turn and logs the cost', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
    const sent = stubProvider();
    const turn = stubTurn();
    const voiceNote = { key: { id: 'V1' }, message: { audioMessage: { seconds: 6, ptt: true } } };

    const transcribe = mock.method(OpenRouterClient, 'transcribe', () =>
      Promise.resolve({
        text: 'quero uma calabresa grande',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.00002 },
        latencyMs: 800
      })
    );

    const text = await receive(storeId, 'V0', 'oi');
    const audio = await receive(storeId, 'V1', '🎤 Áudio', voiceNote);

    await run(customerEvent(text, 'V0'));
    await run(customerEvent(audio, 'V1'));

    equal(sent.length, 1);
    deepEqual(transcribe.mock.calls[0]!.arguments[0], {
      apiKey: 'o',
      model: 'openai/whisper-large-v3-turbo',
      data: 'T2dn',
      format: 'ogg',
      language: 'pt'
    });

    const [input] = turn.mock.calls[0]!.arguments as unknown as [{ messages: { body: string }[] }];

    deepEqual(
      input.messages.map(({ body }) => body),
      ['oi', '🎤 Áudio transcrito: quero uma calabresa grande']
    );

    const stored = await db.messages.findOne({
      select: { body: true, voice_note: true, audio_key: true },
      where: { id: audio.messageId }
    });

    const key = `voice-notes/${storeId}/${audio.messageId}`;

    deepEqual(stored, { body: '🎤 Áudio transcrito: quero uma calabresa grande', voice_note: null, audio_key: key });
    equal(savedAudio.get(key)?.toString('base64'), 'T2dn');

    const { records: calls } = await db.ai_calls.findMany({
      select: { path: true, model: true, cost_usd: true },
      where: { conversation_id: audio.conversationId }
    });

    deepEqual(
      calls.map(({ path, model, cost_usd }) => [path, model, Number(cost_usd)]),
      [['transcription', 'openai/whisper-large-v3-turbo', 0.00002]]
    );
  });

  it('keeps voice notes for the panel in human mode, without transcribing them', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    const transcribe = mock.method(OpenRouterClient, 'transcribe', () => Promise.reject(new Error('unused')));

    const audio = await receive(storeId, 'H1', '🎤 Áudio', { key: { id: 'H1' }, message: { audioMessage: {} } });

    await db.conversations.updateOne({ data: { mode: ConversationMode.Human }, where: { id: audio.conversationId } });
    await run(customerEvent(audio, 'H1'));

    equal(sent.length, 0);
    equal(transcribe.mock.callCount(), 0);

    const stored = await db.messages.findOne({
      select: { body: true, voice_note: true, audio_key: true, processed_at: true },
      where: { id: audio.messageId }
    });

    equal(stored?.body, '🎤 Áudio');
    equal(stored?.voice_note, null);
    equal(stored?.audio_key, `voice-notes/${storeId}/${audio.messageId}`);
    equal(!!stored?.processed_at, true);
  });

  it('transcribes a voice note from its saved copy when the batch waited for the store', async () => {
    const { storeId } = await seedStore(db);
    stubProvider();
    const turn = stubTurn();

    const transcribe = mock.method(OpenRouterClient, 'transcribe', () =>
      Promise.resolve({ text: 'uma coca', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, latencyMs: 1 })
    );

    const audio = await receive(storeId, 'W1', '🎤 Áudio', { key: { id: 'W1' }, message: { audioMessage: {} } });

    await db.conversations.updateOne({ data: { approval_reason: 'order_limit' }, where: { id: audio.conversationId } });
    await run(customerEvent(audio, 'W1'));

    equal(transcribe.mock.callCount(), 0);

    await db.conversations.updateOne({ data: { approval_reason: null }, where: { id: audio.conversationId } });
    await run(customerEvent(audio, 'W1'));

    equal((transcribe.mock.calls[0]!.arguments[0] as { data: string }).data, 'T2dn');

    const [input] = turn.mock.calls[0]!.arguments as unknown as [{ messages: { body: string }[] }];

    deepEqual(
      input.messages.map(({ body }) => body),
      ['🎤 Áudio transcrito: uma coca']
    );
  });

  it('keeps a voice note as media when it cannot be transcribed', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
    const sent = stubProvider(() => Promise.reject(new Error('download failed')));
    const turn = stubTurn();
    const transcribe = mock.method(OpenRouterClient, 'transcribe', () => Promise.reject(new Error('unused')));

    const failed = await receive(storeId, 'F1', '🎤 Áudio', { key: { id: 'F1' }, message: { audioMessage: {} } });
    const long = await receive(storeId, 'F2', '🎤 Áudio', {
      key: { id: 'F2' },
      message: { audioMessage: { seconds: 600 } }
    });

    await run(customerEvent(failed, 'F1'));
    await run(customerEvent(long, 'F2'));

    deepEqual(
      sent.map(({ text }) => text),
      [MEDIA_ONLY_REPLY]
    );
    equal(turn.mock.callCount(), 0);
    equal(transcribe.mock.callCount(), 0);

    const { records } = await db.messages.findMany({
      select: { body: true, voice_note: true },
      where: { conversation_id: long.conversationId, direction: MessageDirection.In }
    });

    deepEqual(
      records.map(({ body, voice_note }) => [body, voice_note]),
      [
        ['oi', null],
        ['🎤 Áudio', null],
        ['🎤 Áudio', null]
      ]
    );
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

  it('sends nothing while waiting for approval, then answers every waiting message once approved', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
    const sent = stubProvider();
    const turn = mock.method(TurnResponder, 'respond', async (input: { conversationId: string }) => {
      // First turn: a tool asked the store to approve a limit.
      if (turn.mock.callCount() === 0) {
        await ConversationRepository.requestApproval(db, {
          conversationId: input.conversationId,
          reason: 'order_limit'
        });

        return { text: 'discarded', mutated: true, awaitingApproval: true };
      }

      return { text: 'Anotado! Mais alguma coisa?', mutated: true };
    });

    const first = await receive(storeId, 'A1', 'quero 30 pizzas');

    await run(customerEvent(first, 'A1'));

    equal(sent.length, 0);

    // A message while waiting runs no turn and stays pending with the first one.
    const second = await receive(storeId, 'A2', 'e uma coca');

    await run(customerEvent(second, 'A2'));

    equal(turn.mock.callCount(), 1);

    await ConversationRepository.approve(db, { conversationId: first.conversationId, reason: 'order_limit' });
    await run(customerEvent(second, 'approval:A2'));

    equal(turn.mock.callCount(), 2);
    deepEqual(
      sent.map(({ text }) => text),
      ['Anotado! Mais alguma coisa?']
    );

    const [input] = turn.mock.calls[1]!.arguments as unknown as [
      { messages: { body: string }[]; approvedReason: string }
    ];

    deepEqual(
      input.messages.map(({ body }) => body),
      ['quero 30 pizzas', 'e uma coca']
    );
    equal(input.approvedReason, 'order_limit');
    deepEqual(await ConversationRepository.pendingInbound(db, first.conversationId), []);
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
      startTyping: () => () => Promise.resolve(),
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
    await returning(storeId);
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
    await returning(storeId);
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
    await returning(storeId);
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

  // First contact: the greeting never goes out with the apology.
  it('hands off with an apology on the last attempt', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));
    mock.method(TurnResponder, 'respond', () => Promise.reject(new TurnError('OpenRouter request failed (503)', true)));

    const ingested = await receive(storeId, 'A3', 'quero uma pizza');

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

  it('hands off at once when the failed turn already changed the order, and alerts the admin', async () => {
    const { storeId } = await seedStore(db);
    const sent = stubProvider();
    const telegram = mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));
    mock.method(TurnResponder, 'respond', () => Promise.reject(new TurnError('Tool round limit reached', false)));

    const ingested = await receive(storeId, 'M1', 'quero calabresa');

    // notifyAdmin reads the process env (other specs clear it).
    process.env.TELEGRAM_BOT_TOKEN = 't';
    process.env.TELEGRAM_CHAT_ID = 'c';

    try {
      await run(customerEvent(ingested, 'M1'), 1, 3);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }

    equal(sent[0]?.text, TECHNICAL_ERROR_REPLY);
    equal((await conversationOf(ingested.conversationId))?.mode, ConversationMode.Human);

    const [url, init] = telegram.mock.calls[0]!.arguments as [string, RequestInit];
    const { text } = JSON.parse(init.body as string) as { text: string };

    ok(url.includes('api.telegram.org'));
    ok(text.includes(ingested.conversationId));
    ok(text.includes('Tentativa: 1/3'));
    ok(text.includes('Erro: Tool round limit reached'));
    ok(!text.includes('calabresa'));
  });

  it('answers a real turn through the LLM agent', async () => {
    const { storeId } = await seedStore(db);
    await returning(storeId);
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
