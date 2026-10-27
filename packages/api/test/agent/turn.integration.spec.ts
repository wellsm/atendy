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
import { OrderRepository } from '../../src/orders/repository';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { DeliveryMode, PaymentMethod, PreviousAddress, RouterType } from '../../src/stores/types';
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

  it('offers the previous order once and the saved address while the order has none', async () => {
    const turn = await setup({
      repeat_order_statuses: [OrderStatus.Done],
      previous_address: PreviousAddress.OnRequest
    });
    const orderId = await placeOrder(db, scopeOf(turn), turn.menu);

    // Yesterday's delivered order: outside the memory window, so a new order starts.
    await db.orders.updateOne({
      data: {
        status: OrderStatus.Done,
        placed_at: minutesAgo(24 * 60),
        fulfillment: Fulfillment.Delivery,
        address: 'Rua das Flores, 10',
        neighborhood: 'Centro'
      },
      where: { id: orderId }
    });

    const chat = replyWith('Quer repetir o pedido de ontem?');

    await TurnResponder.respond({ db, env, ...turn });

    const state = stateOf(chat);

    deepEqual(state.saved_address, { address: 'Rua das Flores, 10', neighborhood: 'Centro', offer: 'on_request' });
    deepEqual(state.previous_order, {
      items: [{ name: 'Coca-Cola 2L', qty: 1, options: '' }],
      total_cents: 1400,
      days_ago: 1
    });

    // Once the bot spoke in this thread, the offer is not repeated.
    await ConversationRepository.recordOutbound(db, {
      storeId: turn.store.id,
      conversationId: turn.conversationId,
      author: MessageAuthor.Bot,
      body: 'Quer repetir o pedido de ontem?',
      providerMessageId: 'BOT-R1'
    });

    chat.mock.resetCalls();

    await TurnResponder.respond({ db, env, ...turn });

    equal(stateOf(chat).previous_order, undefined);
  });

  it('swaps the summary token for the current draft, prices from the cart', async () => {
    const turn = await setup({ delivery_min_minutes: 40, delivery_max_minutes: 50 });
    const scope = scopeOf(turn);

    await OrderRepository.addItem(db, scope, {
      product: productByName(turn.menu, 'Coca-Cola 2L'),
      qty: 2,
      selections: []
    });
    await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);

    replyWith('Confere o resumo 👇\n---\n[[resumo]]\n---\nPosso confirmar?');

    const { text } = await TurnResponder.respond({ db, env, ...turn });

    equal(
      text,
      [
        'Confere o resumo 👇',
        '---',
        '🧾 *Resumo do pedido*',
        '',
        '➡️ 2x Coca-Cola 2L',
        '   R$\u00a028,00',
        '',
        '🛍️ Retirada na loja',
        '',
        '💰 *Total: R$\u00a028,00*',
        '---',
        'Posso confirmar?'
      ].join('\n')
    );
  });

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

    deepEqual(await TurnResponder.respond({ db, env, ...turn }), {
      text: 'Oi de novo!',
      mutated: false,
      awaitingApproval: false
    });

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

    const lastOrder = stateOf(chat).last_order as LastOrder;

    equal(lastOrder.editable, false);
    // Default: one order at a time.
    equal(lastOrder.new_order_allowed, false);
    // Default add-ons: the drink categories of the menu.
    deepEqual(lastOrder.add_on, { categories: ['Bebidas'], extra_minutes: null });
  });

  it('tells the model a placed order takes no new order and no add-on', async () => {
    const turn = await setup();

    await placeOrder(db, scopeOf(turn), turn.menu);

    const chat = replyWith('Ok!');

    await TurnResponder.respond({ db, env, ...turn });

    const lastOrder = stateOf(chat).last_order as LastOrder;

    equal(lastOrder.new_order_allowed, false);
    equal(lastOrder.add_on, null);
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

  it('gives the model the public menu link, built in code', async () => {
    const turn = await setup();
    const chat = replyWith('Nosso cardápio: https://web.test/loja-1');

    await TurnResponder.respond({ db, env, ...turn, menuUrl: 'https://web.test/loja-1' });

    equal((stateOf(chat) as { store: { menu_url: string } }).store.menu_url, 'https://web.test/loja-1');

    const other = await setup();
    const withoutLink = replyWith('Oi!');

    await TurnResponder.respond({ db, env, ...other });

    equal('menu_url' in (stateOf(withoutLink) as { store: object }).store, false);
  });
});
