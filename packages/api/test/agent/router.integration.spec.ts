import type { JevAnswer, JevQuestion } from '../../src/agent/jev-client';
import type { AgentStore } from '../../src/agent/prompt';
import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';
import type { StorePolicy } from '../../src/stores/types';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { AiRequestError } from '../../src/agent/errors';
import { JevClient } from '../../src/agent/jev-client';
import {
  groupQuestionId,
  Intent,
  NONE_OF_THESE,
  NOT_MENTIONED,
  Q_INTENT,
  Q_PRODUCT,
  Q_QTY
} from '../../src/agent/jev-router';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { PROMPT_VERSION } from '../../src/agent/prompt-version';
import { AgentRouter } from '../../src/agent/router';
import { AiPath, AiProvider } from '../../src/agent/types';
import { ConversationMode } from '../../src/conversations/types';
import { OrderRepository } from '../../src/orders/repository';
import { OrderStatus } from '../../src/orders/types';
import { DeliveryMode, PaymentMethod, RouterType } from '../../src/stores/types';
import { bodyForModel } from '../../src/whatsapp/location';
import { formatReactionBody } from '../../src/whatsapp/reaction';
import { groupIdOf, placeOrder, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('AgentRouter', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const env = { OPENROUTER_API_KEY: 'o' };

  const setup = async (router: RouterType, policy?: StorePolicy) => {
    const { storeId } = await seedStore(db, { router, policy });
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);

    const ctx: ToolContext = { db, storeId, conversationId, customerId, menu, mutated: false };

    const store: AgentStore = {
      id: storeId,
      name: 'Pizzaria Teste',
      timezone: 'America/Sao_Paulo',
      router,
      llm_model: 'test/model',
      payment_methods: [PaymentMethod.Pix],
      delivery_mode: DeliveryMode.Flat,
      flat_fee_cents: 0,
      policy
    };

    return { ctx, menu, store };
  };

  const textReply = (content: string) =>
    mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve({
        message: { role: 'assistant' as const, content },
        usage: { inputTokens: 50, outputTokens: 10, costUsd: 0.00002 },
        latencyMs: 30
      })
    );

  const jevAnswers = (picks: Record<string, string>, confidence = 0.9) =>
    mock.method(JevClient, 'evaluate', (input: { questions: Record<string, JevQuestion> }) =>
      Promise.resolve({
        model: 'jev-1.13.0',
        answers: Object.fromEntries(
          Object.entries(input.questions).map(([id, question]): [string, JevAnswer] => {
            if (question.type === 'noul') {
              return [id, { type: 'noul', noul: 0.01 }];
            }

            const keys = Object.keys(question.criteria);
            const fallback = keys.includes(NOT_MENTIONED) ? NOT_MENTIONED : NONE_OF_THESE;

            return [id, { type: 'choice', choice: picks[id] ?? fallback, probabilities: {}, confidence }];
          })
        ),
        usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.000042 },
        latencyMs: 80
      })
    );

  const calls = async (conversationId: string, path: AiPath, provider: AiProvider) => {
    return db.ai_calls.count({ where: { conversation_id: conversationId, path, provider } });
  };

  it('executes a confident Jev decision in code and writes the reply with one tool-less call', async () => {
    const { ctx, menu, store } = await setup(RouterType.Jev);
    const broto = productByName(menu, 'Pizza Broto');

    jevAnswers({
      [Q_INTENT]: Intent.AddItem,
      [Q_PRODUCT]: 'Pizza Broto (Pizzas)',
      [Q_QTY]: '1',
      [groupQuestionId(groupIdOf(broto, 'Sabor'))]: 'Calabresa'
    });

    const chat = textReply('Anotei 1 broto de calabresa! Entrega ou retirada?');

    const text = await AgentRouter.run({
      ctx,
      env,
      store,
      cart: undefined,
      history: [],
      messages: ['quero uma broto de calabresa']
    });

    equal(text, 'Anotei 1 broto de calabresa! Entrega ou retirada?');
    equal(chat.mock.callCount(), 1);
    equal((chat.mock.calls[0]!.arguments[0] as { tools?: unknown }).tools, undefined);
    equal(await calls(ctx.conversationId, AiPath.JevDirect, AiProvider.Jev), 1);
    equal(await calls(ctx.conversationId, AiPath.LlmReply, AiProvider.OpenRouter), 1);

    const {
      records: [jevCall]
    } = await db.ai_calls.findMany({
      select: { intent: true, cost_usd: true },
      where: { conversation_id: ctx.conversationId, provider: AiProvider.Jev }
    });

    equal(jevCall?.intent, Intent.AddItem);
    equal(Number(jevCall?.cost_usd), 0.000042);

    const {
      records: [traced]
    } = await db.ai_calls.findMany({
      select: { tools: true, prompt_version: true },
      where: { conversation_id: ctx.conversationId, provider: AiProvider.Jev }
    });

    equal(traced?.prompt_version, PROMPT_VERSION);
    equal(traced?.tools?.length, 1);
    equal(traced?.tools?.[0]?.name, 'add_item');
    equal(traced?.tools?.[0]?.ok, true);

    const draftId = await OrderRepository.findDraftId(db, ctx.conversationId);

    equal((await OrderRepository.getCart(db, draftId!)).subtotal_cents, 2990);
  });

  it('falls back to the full agent when Jev is unsure, logging the Jev call as fallback', async () => {
    const { ctx, store } = await setup(RouterType.Jev);

    jevAnswers({ [Q_INTENT]: Intent.AddItem }, 0.3);
    const chat = textReply('Qual sabor você prefere?');

    await AgentRouter.run({ ctx, env, store, cart: undefined, history: [], messages: ['me vê uma pizza'] });

    equal((chat.mock.calls[0]!.arguments[0] as { tools?: unknown[] }).tools?.length, 12);
    equal(await calls(ctx.conversationId, AiPath.LlmFallback, AiProvider.Jev), 1);
    equal(await calls(ctx.conversationId, AiPath.LlmFallback, AiProvider.OpenRouter), 1);
  });

  it('falls back to the full agent when Jev fails', async () => {
    const { ctx, store } = await setup(RouterType.Jev);

    mock.method(JevClient, 'evaluate', () =>
      Promise.reject(new AiRequestError('Jev request failed (503)', AiProvider.Jev, 503))
    );
    const chat = textReply('Olá! O que vai ser hoje?');

    equal(
      await AgentRouter.run({ ctx, env, store, cart: undefined, history: [], messages: ['oi'] }),
      'Olá! O que vai ser hoje?'
    );
    equal(chat.mock.callCount(), 1);
    equal(await db.ai_calls.count({ where: { conversation_id: ctx.conversationId, provider: AiProvider.Jev } }), 0);
  });

  it('never calls Jev on the llm router', async () => {
    const { ctx, store } = await setup(RouterType.Llm);

    const evaluate = jevAnswers({});
    textReply('Olá!');

    await AgentRouter.run({ ctx, env, store, cart: undefined, history: [], messages: ['oi'] });

    equal(evaluate.mock.callCount(), 0);
  });

  it('sends a reaction to the full agent instead of letting Jev act on it', async () => {
    const { ctx, store } = await setup(RouterType.Jev);

    const evaluate = jevAnswers({ [Q_INTENT]: Intent.AddItem });
    const chat = textReply('Qual forma de pagamento você prefere: Pix, cartão ou dinheiro?');

    await AgentRouter.run({
      ctx,
      env,
      store,
      cart: undefined,
      history: [],
      messages: [bodyForModel(formatReactionBody('👍', 'Vai ser Pix, cartão ou dinheiro?'))]
    });

    equal(evaluate.mock.callCount(), 0);
    equal(chat.mock.callCount(), 1);
  });

  it('writes no reply when the direct tool asked the store to approve a limit', async () => {
    const { ctx, store } = await setup(RouterType.Jev, { max_item_qty: 1 });

    jevAnswers({ [Q_INTENT]: Intent.AddItem, [Q_PRODUCT]: 'Coca-Cola 2L (Bebidas)', [Q_QTY]: '2' });

    const chat = textReply('Vou chamar um atendente para te ajudar.');

    const text = await AgentRouter.run({
      ctx,
      env,
      store,
      cart: undefined,
      history: [],
      messages: ['quero 2 coca-cola']
    });

    equal(text, '');
    equal(chat.mock.callCount(), 0);
    equal(ctx.awaitingApproval, true);

    const conversation = await db.conversations.findOne({
      select: { mode: true, approval_reason: true },
      where: { id: ctx.conversationId }
    });

    deepEqual(conversation, { mode: ConversationMode.Bot, approval_reason: 'qty_limit' });
  });

  it('sends a change to an order the store already accepted to the LLM instead of a new Jev draft', async () => {
    const { ctx, menu, store } = await setup(RouterType.Jev);
    const orderId = await placeOrder(db, ctx, menu);

    await db.orders.updateOne({ data: { status: OrderStatus.Accepted }, where: { id: orderId } });

    jevAnswers({ [Q_INTENT]: Intent.AddItem, [Q_PRODUCT]: 'Coca-Cola 2L (Bebidas)', [Q_QTY]: '1' });

    const chat = textReply('Seu pedido já foi aceito, vou chamar um atendente.');

    await AgentRouter.run({
      ctx,
      env,
      store,
      cart: undefined,
      history: [],
      messages: ['esqueci a coca'],
      lastOrder: {
        order_id: orderId,
        items: [],
        total_cents: 1400,
        status: OrderStatus.Accepted,
        minutes_ago: 5,
        editable: false,
        new_order_allowed: true,
        add_on: null
      }
    });

    equal((chat.mock.calls[0]!.arguments[0] as { tools?: unknown }).tools !== undefined, true);
    equal(await OrderRepository.findDraftId(db, ctx.conversationId), undefined);
  });
});
