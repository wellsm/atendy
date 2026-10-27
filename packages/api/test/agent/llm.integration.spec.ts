import type { ChatMessage, ToolCall } from '../../src/agent/openrouter-client';
import type { ToolContext } from '../../src/agent/tools';
import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { AnthropicClient } from '../../src/agent/anthropic-client';
import { AiRequestError } from '../../src/agent/errors';
import { LlmAgent, MAX_TOOL_ROUNDS } from '../../src/agent/llm';
import { OpenRouterClient } from '../../src/agent/openrouter-client';
import { buildSystemPrompt, buildTurnState, SYSTEM_PROMPT } from '../../src/agent/prompt';
import { AiPath, AiProvider } from '../../src/agent/types';
import { MessageAuthor } from '../../src/conversations/types';
import { OrderRepository } from '../../src/orders/repository';
import { DeliveryMode, PaymentMethod, RouterType } from '../../src/stores/types';
import { groupIdOf, optionIdOf, productByName, seedConversation, seedMenu, seedStore } from '../support/fixtures';

describe('LlmAgent', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const menu = await seedMenu(db, storeId);
    const { conversationId, customerId } = await seedConversation(db, storeId);

    const ctx: ToolContext = { db, storeId, conversationId, customerId, menu, mutated: false };

    return { ctx, menu };
  };

  const chatResult = (message: { content: string | null; tool_calls?: ToolCall[] }) => ({
    message: { role: 'assistant' as const, ...message },
    usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.0001 },
    latencyMs: 50
  });

  const call = (id: string, name: string, args: unknown): ToolCall => ({
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
  });

  const queue = (results: ReturnType<typeof chatResult>[]) => {
    return mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve(results.shift() ?? chatResult({ content: 'fim' }))
    );
  };

  const runAgent = (ctx: ToolContext, tools = true) =>
    LlmAgent.run({
      ctx,
      apiKey: 'k',
      model: 'test/model',
      system: SYSTEM_PROMPT,
      state: '{}',
      path: AiPath.LlmFallback,
      tools
    });

  it('runs tools until the model answers and logs every call', async () => {
    const { ctx, menu } = await setup();
    const broto = productByName(menu, 'Pizza Broto');

    const chat = queue([
      chatResult({
        content: null,
        tool_calls: [
          call('c1', 'add_item', {
            product_id: broto.id,
            qty: 1,
            selections: [{ group_id: groupIdOf(broto, 'Sabor'), option_ids: [optionIdOf(broto, 'Sabor', 'Calabresa')] }]
          })
        ]
      }),
      chatResult({ content: 'Anotei 1 broto de calabresa. Entrega ou retirada?' })
    ]);

    const text = await runAgent(ctx);

    equal(text, 'Anotei 1 broto de calabresa. Entrega ou retirada?');
    equal(ctx.mutated, true);

    const second = chat.mock.calls[1]!.arguments[0] as { messages: ChatMessage[] };
    const toolMessage = second.messages.at(-1) as { role: 'tool'; tool_call_id: string; content: string };

    equal(toolMessage.role, 'tool');
    equal(toolMessage.tool_call_id, 'c1');
    equal((JSON.parse(toolMessage.content) as { ok: boolean }).ok, true);

    equal(await db.ai_calls.count({ where: { conversation_id: ctx.conversationId, path: AiPath.LlmFallback } }), 2);

    const draftId = await OrderRepository.findDraftId(db, ctx.conversationId);

    equal((await OrderRepository.getCart(db, draftId!)).subtotal_cents, 2990);
  });

  it('feeds tool errors back to the model', async () => {
    const { ctx } = await setup();

    const chat = queue([
      chatResult({ content: null, tool_calls: [call('c1', 'add_item', '{not json')] }),
      chatResult({ content: 'Qual produto você quer?' })
    ]);

    equal(await runAgent(ctx), 'Qual produto você quer?');

    const second = chat.mock.calls[1]!.arguments[0] as { messages: ChatMessage[] };
    const toolMessage = second.messages.at(-1) as { content: string };

    deepEqual(JSON.parse(toolMessage.content), {
      ok: false,
      error: 'invalid_arguments',
      message: 'arguments must be an object'
    });
    equal(ctx.mutated, false);
  });

  it('does not offer or run tools on a reply-only call', async () => {
    const { ctx } = await setup();

    const chat = queue([chatResult({ content: 'Pronto!', tool_calls: [call('c1', 'place_order', {})] })]);

    equal(await runAgent(ctx, false), 'Pronto!');
    equal((chat.mock.calls[0]!.arguments[0] as { tools?: unknown }).tools, undefined);
    equal(ctx.mutated, false);
  });

  it('gives up after too many tool rounds', async () => {
    const { ctx } = await setup();

    const chat = mock.method(OpenRouterClient, 'chat', () =>
      Promise.resolve(chatResult({ content: null, tool_calls: [call('c', 'get_cart', {})] }))
    );

    await rejects(runAgent(ctx), AiRequestError);
    equal(chat.mock.callCount(), MAX_TOOL_ROUNDS);
  });

  it('forces a text answer on the last round instead of failing', async () => {
    const { ctx } = await setup();

    const chat = mock.method(OpenRouterClient, 'chat', (input: { toolChoice?: string }) =>
      Promise.resolve(
        input.toolChoice === 'none'
          ? chatResult({ content: 'Seu pedido está anotado.' })
          : chatResult({ content: null, tool_calls: [call('c', 'get_cart', {})] })
      )
    );

    equal(await runAgent(ctx), 'Seu pedido está anotado.');
    equal(chat.mock.callCount(), MAX_TOOL_ROUNDS);
  });

  it('treats empty tool arguments as no arguments', async () => {
    const { ctx } = await setup();

    const chat = queue([
      chatResult({ content: null, tool_calls: [call('c1', 'get_cart', '')] }),
      chatResult({ content: 'Seu carrinho está vazio.' })
    ]);

    await runAgent(ctx);

    const second = chat.mock.calls[1]!.arguments[0] as { messages: ChatMessage[] };

    equal((JSON.parse((second.messages.at(-1) as { content: string }).content) as { ok: boolean }).ok, true);
  });

  it('fails on an empty reply and without an API key', async () => {
    const { ctx } = await setup();

    queue([chatResult({ content: '   ' })]);

    await rejects(runAgent(ctx), AiRequestError);

    await rejects(
      LlmAgent.run({
        ctx,
        apiKey: undefined,
        model: 'm',
        system: '',
        state: '{}',
        path: AiPath.LlmFallback,
        tools: true
      }),
      AiRequestError
    );
  });

  it('runs direct Anthropic models on the Anthropic key and logs them as Anthropic', async () => {
    const { ctx } = await setup();

    const openRouter = queue([]);
    const anthropic = mock.method(AnthropicClient, 'chat', () => Promise.resolve(chatResult({ content: 'Oi!' })));

    const run = (anthropicApiKey: string | undefined) =>
      LlmAgent.run({
        ctx,
        apiKey: 'or-key',
        anthropicApiKey,
        model: 'anthropic-direct/claude-haiku-5-5',
        system: SYSTEM_PROMPT,
        state: '{}',
        path: AiPath.LlmFallback,
        tools: true
      });

    equal(await run('an-key'), 'Oi!');

    const [sent] = anthropic.mock.calls[0]!.arguments as [{ apiKey: string; model: string }];

    equal(sent.apiKey, 'an-key');
    equal(sent.model, 'claude-haiku-5-5');
    equal(openRouter.mock.callCount(), 0);

    const { records } = await db.ai_calls.findMany({
      select: { provider: true, model: true },
      where: { conversation_id: ctx.conversationId }
    });

    deepEqual(records, [{ provider: AiProvider.Anthropic, model: 'anthropic-direct/claude-haiku-5-5' }]);

    // The OpenRouter key never stands in for a missing Anthropic key.
    await rejects(
      run(undefined),
      (error) => error instanceof AiRequestError && error.provider === AiProvider.Anthropic
    );
  });

  it('builds the turn state with store, cart, history and new messages', () => {
    const state = JSON.parse(
      buildTurnState({
        store: {
          id: 's',
          name: 'Pizzaria Teste',
          timezone: 'America/Sao_Paulo',
          router: RouterType.Llm,
          llm_model: 'm',
          payment_methods: [PaymentMethod.Pix],
          delivery_mode: DeliveryMode.Flat,
          flat_fee_cents: 800
        },
        cart: undefined,
        history: [{ author: MessageAuthor.Bot, body: 'Olá!' }],
        messages: ['quero pizza'],
        action: { tool: 'search_menu', result: { products: [] } }
      })
    ) as Record<string, unknown>;

    deepEqual(state, {
      store: { name: 'Pizzaria Teste', payment_methods: ['pix'], delivery: { mode: 'flat', fee_cents: 800 } },
      cart: null,
      last_order: null,
      closing_soon: false,
      recent_history: [{ author: 'bot', body: 'Olá!' }],
      new_messages: ['quero pizza'],
      action: { tool: 'search_menu', result: { products: [] } }
    });
  });

  it('lists only the limits the model explains', () => {
    const state = JSON.parse(
      buildTurnState({
        store: {
          id: 's',
          name: 'Pizzaria Teste',
          timezone: 'America/Sao_Paulo',
          router: RouterType.Llm,
          llm_model: 'm',
          payment_methods: [PaymentMethod.Pix],
          delivery_mode: DeliveryMode.Flat,
          flat_fee_cents: 0,
          policy: { min_order_cents: 3000, max_change_cents: null, new_customer_review_cents: 9000, sop: 'x' }
        },
        cart: undefined,
        history: [],
        messages: ['oi']
      })
    ) as { store: { limits?: unknown } };

    deepEqual(state.store.limits, { min_order_cents: 3000 });
  });

  it('appends the store SOP after the fixed rules, capped at 2000 characters', () => {
    equal(buildSystemPrompt(undefined), SYSTEM_PROMPT);
    equal(buildSystemPrompt('  '), SYSTEM_PROMPT);

    const prompt = buildSystemPrompt('Não aceitamos troco para R$ 200.');

    equal(prompt.startsWith(SYSTEM_PROMPT), true);
    equal(prompt.endsWith('Não aceitamos troco para R$ 200.'), true);

    const long = buildSystemPrompt('a'.repeat(3000));

    equal(long.endsWith(`\n${'a'.repeat(2000)}`), true);
  });
});
