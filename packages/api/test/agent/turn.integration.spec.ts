import type { LastOrder } from '../../src/agent/prompt';
import type { Db } from '../../src/db';
import type { StorePolicy } from '../../src/stores/types';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { AiRequestError, TurnError } from '../../src/agent/errors';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { TurnResponder } from '../../src/agent/turn';
import { AiProvider } from '../../src/agent/types';
import { ConversationRepository } from '../../src/conversations/repository';
import { MessageAuthor } from '../../src/conversations/types';
import { OrderStatus } from '../../src/orders/types';
import { DeliveryMode, PaymentMethod, RouterType } from '../../src/stores/types';
import {
  hoursClosingIn,
  minutesAgo,
  placeOrder,
  productByName,
  seedConversation,
  seedMenu,
  seedMessage,
  seedStore
} from '../support/fixtures';

describe('TurnResponder', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const env = { OPENROUTER_API_KEY: 'o' };

  const setup = async (policy?: StorePolicy, timezone = 'America/Sao_Paulo') => {
    const { storeId } = await seedStore(db, { policy, timezone });
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId, messageId } = await seedConversation(db, storeId);

    const store = {
      id: storeId,
      name: 'Pizzaria Teste',
      timezone,
      router: RouterType.Llm,
      llm_model: 'test/model',
      payment_methods: [PaymentMethod.Pix],
      delivery_mode: DeliveryMode.Flat,
      flat_fee_cents: 0,
      policy
    };

    return {
      menu,
      store,
      hours: [] as ReturnType<typeof hoursClosingIn>,
      conversationId,
      customerId,
      messages: [{ id: messageId, body: 'oi' }]
    };
  };

  const scopeOf = (turn: Awaited<ReturnType<typeof setup>>) => ({
    storeId: turn.store.id,
    conversationId: turn.conversationId,
    customerId: turn.customerId
  });

  const replyWith = (content: string) =>
    mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        latencyMs: 1
      })
    );

  const sentMessages = (chat: ReturnType<typeof replyWith>) =>
    (chat.mock.calls[0]!.arguments[0] as { messages: { content: string }[] }).messages;

  const stateOf = (chat: ReturnType<typeof replyWith>) =>
    JSON.parse(sentMessages(chat)[1]!.content) as Record<string, unknown>;

  const failure = () => new AiRequestError('OpenRouter request failed (503)', AiProvider.OpenRouter, 503);

  it('sends history without the pending messages and the current cart to the model', async () => {
    const turn = await setup();

    await ConversationRepository.recordOutbound(db, {
      storeId: turn.store.id,
      conversationId: turn.conversationId,
      author: MessageAuthor.Bot,
      body: 'Olá! O que vai ser?',
      providerMessageId: 'BOT-H1'
    });

    const chat = mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content: 'Oi de novo!' },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        latencyMs: 1
      })
    );

    deepEqual(await TurnResponder.respond({ db, env, ...turn }), { text: 'Oi de novo!', mutated: false });

    const { messages } = chat.mock.calls[0]!.arguments[0] as { messages: { content: string }[] };
    const state = JSON.parse(messages[1]!.content) as { recent_history: unknown; new_messages: unknown; cart: unknown };

    deepEqual(state.recent_history, [{ author: 'bot', body: 'Olá! O que vai ser?' }]);
    deepEqual(state.new_messages, ['oi']);
    equal(state.cart, null);
  });

  it('marks an AI failure retryable while nothing changed', async () => {
    const turn = await setup();

    mock.method(OpenRouterClient, 'chat', () => Promise.reject(failure()));

    await rejects(
      TurnResponder.respond({ db, env, ...turn }),
      (error) => error instanceof TurnError && error.retryable
    );
  });

  it('marks an AI failure not retryable once a tool changed the order', async () => {
    const turn = await setup();
    const coca = productByName(turn.menu, 'Coca-Cola 2L');
    let calls = 0;

    mock.method(OpenRouterClient, 'chat', () => {
      calls += 1;

      if (calls > 1) {
        return Promise.reject(failure());
      }

      return Promise.resolve({
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function' as const,
              function: { name: 'add_item', arguments: JSON.stringify({ product_id: coca.id, qty: 1 }) }
            }
          ]
        },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        latencyMs: 1
      });
    });

    await rejects(
      TurnResponder.respond({ db, env, ...turn }),
      (error) => error instanceof TurnError && !error.retryable
    );
  });

  it('marks any failure not retryable once a tool changed the order', async () => {
    const turn = await setup();
    const coca = productByName(turn.menu, 'Coca-Cola 2L');
    let calls = 0;

    mock.method(OpenRouterClient, 'chat', () => {
      calls += 1;

      if (calls > 1) {
        return Promise.reject(new Error('db down'));
      }

      return Promise.resolve({
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function' as const,
              function: { name: 'add_item', arguments: JSON.stringify({ product_id: coca.id }) }
            }
          ]
        },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        latencyMs: 1
      });
    });

    await rejects(
      TurnResponder.respond({ db, env, ...turn }),
      (error) => error instanceof TurnError && !error.retryable
    );
  });

  it('starts a new thread after placing and shows the order still waiting for the store', async () => {
    const turn = await setup();
    const scope = scopeOf(turn);

    await seedMessage(db, { ...scope, author: MessageAuthor.Bot, body: 'Qual sabor?', createdAt: minutesAgo(20) });

    const orderId = await placeOrder(db, scope, turn.menu);

    await db.orders.updateOne({ data: { placed_at: minutesAgo(10) }, where: { id: orderId } });
    await seedMessage(db, { ...scope, author: MessageAuthor.Bot, body: 'Pedido enviado!', createdAt: minutesAgo(9) });

    const chat = replyWith('Claro!');

    await TurnResponder.respond({ db, env, ...turn });

    const state = stateOf(chat);
    const lastOrder = state.last_order as LastOrder;

    deepEqual(state.recent_history, [{ author: 'bot', body: 'Pedido enviado!' }]);
    equal(state.cart, null);
    equal(lastOrder.order_id, orderId);
    equal(lastOrder.status, OrderStatus.Placed);
    equal(lastOrder.editable, true);
    equal(lastOrder.minutes_ago, 10);
    equal(lastOrder.items.length, 1);
  });

  it('shows an accepted order as not editable', async () => {
    const turn = await setup();
    const orderId = await placeOrder(db, scopeOf(turn), turn.menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    const chat = replyWith('Já está sendo preparado!');

    await TurnResponder.respond({ db, env, ...turn });

    equal((stateOf(chat).last_order as LastOrder).editable, false);
  });

  it('forgets the previous order and its messages after the memory window', async () => {
    const turn = await setup({ order_memory_hours: 1 });
    const scope = scopeOf(turn);

    await seedMessage(db, { ...scope, author: MessageAuthor.Bot, body: 'Antiga', createdAt: minutesAgo(90) });

    const orderId = await placeOrder(db, scope, turn.menu);

    await db.orders.updateOne({ data: { placed_at: minutesAgo(80) }, where: { id: orderId } });

    const chat = replyWith('Olá!');

    await TurnResponder.respond({ db, env, ...turn });

    const state = stateOf(chat);

    deepEqual(state.recent_history, []);
    equal(state.last_order, null);
  });

  it('passes closing_soon, the store limits and the SOP to the model', async () => {
    const turn = await setup(
      { last_order_minutes: 30, min_order_cents: 3000, sop: 'Não aceitamos troco para R$ 200.' },
      'UTC'
    );

    const chat = replyWith('Estamos fechando em breve!');

    await TurnResponder.respond({ db, env, ...turn, hours: hoursClosingIn(10) });

    const state = stateOf(chat) as { closing_soon: boolean; store: { limits: unknown } };

    equal(state.closing_soon, true);
    deepEqual(state.store.limits, { min_order_cents: 3000 });
    equal(sentMessages(chat)[0]!.content.includes('Não aceitamos troco para R$ 200.'), true);
  });
});
