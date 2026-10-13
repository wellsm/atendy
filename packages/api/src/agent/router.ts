import type { JevDecision } from './jev-router';
import type { AgentStore, HistoryMessage, LastOrder } from './prompt';
import type { ToolContext } from './tools';
import type { Cart } from '../orders/repository';

import { AiRequestError } from './errors';
import { JevClient } from './jev-client';
import { buildJevPlan, decideJevAction, MAX_PRODUCT_CANDIDATES } from './jev-router';
import { LlmAgent } from './llm';
import { buildSystemPrompt, buildTurnState, REPLY_SYSTEM_PROMPT } from './prompt';
import { AiCallRepository } from './repository';
import { executeTool, ToolName } from './tools';
import { AiPath, AiProvider } from './types';
import { searchMenu } from '../menu/search';
import { RouterType } from '../stores/types';

export type AgentEnv = {
  OPENROUTER_API_KEY?: string;
};

export type RouterInput = {
  ctx: ToolContext;
  env: AgentEnv;
  store: AgentStore;
  cart: Cart | undefined;
  history: HistoryMessage[];
  messages: string[];
  lastOrder?: LastOrder | null;
  closingSoon?: boolean;
};

/**
 * Jev path: one System One request, then (when code can act) one tool + a tool-less reply.
 * Returns `undefined` to fall back to the full LLM agent (Jev failure included: the LLM can still answer).
 */
const tryJev = async (input: RouterInput) => {
  const { ctx, env } = input;

  if (!env.OPENROUTER_API_KEY) {
    return undefined;
  }

  const text = input.messages.join('\n');
  const matches = searchMenu(ctx.menu, text);

  const plan = buildJevPlan({
    messages: input.messages,
    history: input.history,
    cart: input.cart,
    candidates: (matches.length ? matches : ctx.menu).slice(0, MAX_PRODUCT_CANDIDATES),
    paymentMethods: input.store.payment_methods,
    lastOrder: input.lastOrder
  });

  let result: Awaited<ReturnType<typeof JevClient.evaluate>>;

  try {
    result = await JevClient.evaluate({ apiKey: env.OPENROUTER_API_KEY, state: plan.state, questions: plan.questions });
  } catch (error) {
    if (error instanceof AiRequestError) {
      return undefined;
    }

    throw error;
  }

  const decided = decideJevAction(plan, result.answers, { menu: ctx.menu, text });

  // The store already took the previous order: the LLM tells a change (human) from a new order.
  const locked = !!input.lastOrder && !input.lastOrder.editable && !input.cart;

  const decision: JevDecision =
    decided.kind === 'direct' && locked && decided.tool !== ToolName.CallHuman && decided.tool !== ToolName.SearchMenu
      ? { kind: 'fallback', reason: 'order_not_editable', intent: decided.intent, confidence: decided.confidence }
      : decided;

  await AiCallRepository.record(ctx.db, {
    storeId: ctx.storeId,
    conversationId: ctx.conversationId,
    provider: AiProvider.Jev,
    model: result.model,
    path: decision.kind === 'direct' ? AiPath.JevDirect : AiPath.LlmFallback,
    intent: decision.intent ?? null,
    confidence: decision.confidence ?? null,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    latencyMs: result.latencyMs
  });

  if (decision.kind !== 'direct') {
    return undefined;
  }

  const action = await executeTool(ctx, decision.tool, decision.args);

  // A failed tool goes to the full agent, unless it already handed the conversation to a human: only the reply is left.
  if (!action.ok && !ctx.mutated) {
    return undefined;
  }

  return LlmAgent.run({
    ctx,
    apiKey: env.OPENROUTER_API_KEY,
    model: input.store.llm_model,
    system: REPLY_SYSTEM_PROMPT,
    state: buildTurnState({
      ...input,
      action: {
        tool: decision.tool,
        result: action.ok ? action.data : { error: action.error, message: action.message }
      }
    }),
    path: AiPath.LlmReply,
    tools: false
  });
};

export namespace AgentRouter {
  export const run = async (input: RouterInput) => {
    if (input.store.router === RouterType.Jev) {
      const reply = await tryJev(input);

      if (reply !== undefined) {
        return reply;
      }
    }

    return LlmAgent.run({
      ctx: input.ctx,
      apiKey: input.env.OPENROUTER_API_KEY,
      model: input.store.llm_model,
      system: buildSystemPrompt(input.store.policy?.sop),
      state: buildTurnState(input),
      path: AiPath.LlmFallback,
      tools: true
    });
  };
}
