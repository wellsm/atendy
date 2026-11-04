import type { AgentEnv } from './router';
import type { TurnInput } from './turn';
import type { StoreRedirect } from '../stores/types';

import { AiRequestError, TurnError } from './errors';
import { LlmAgent } from './llm';
import { buildRedirectPrompt, buildRedirectState, HISTORY_LIMIT } from './prompt';
import { ToolName } from './tools';
import { AiPath } from './types';
import { ConversationRepository } from '../conversations/repository';
import { MenuRepository } from '../menu/repository';
import { formatHours, isStoreOpen } from '../stores/hours';
import { orderMemorySince } from '../stores/policy';
import { bodyForModel } from '../whatsapp/location';

/**
 * A redirect store reads its catalog and may hand off; it never builds orders.
 */
const REDIRECT_TOOLS = [ToolName.SearchMenu, ToolName.CallHuman];

export namespace RedirectResponder {
  /**
   * The reply of a `redirect_only` store after its fixed welcome. Same failure contract as `TurnResponder.respond`.
   */
  export const respond = async (
    input: Pick<TurnInput, 'db' | 'store' | 'hours' | 'conversationId' | 'customerId' | 'messages'> & {
      env: AgentEnv;
      redirect: StoreRedirect;
    }
  ) => {
    const { db, store, conversationId } = input;
    const now = new Date();

    const [menu, recent] = await Promise.all([
      MenuRepository.load(db, store.id),
      ConversationRepository.recentMessages(db, {
        conversationId,
        limit: HISTORY_LIMIT,
        excludeIds: input.messages.map(({ id }) => id),
        since: orderMemorySince(store.policy, now)
      })
    ]);

    const ctx = { storeId: store.id, conversationId, customerId: input.customerId, db, menu, mutated: false };

    try {
      const text = await LlmAgent.run({
        ctx,
        apiKey: input.env.OPENROUTER_API_KEY,
        anthropicApiKey: input.env.ANTHROPIC_API_KEY,
        model: store.llm_model,
        system: buildRedirectPrompt(store.policy?.sop, store.store_type),
        state: buildRedirectState({
          storeName: store.name,
          redirect: input.redirect,
          hours: formatHours(input.hours),
          openNow: isStoreOpen(input.hours, store.timezone, now),
          history: recent.map((message) => ({ ...message, body: bodyForModel(message.body) })),
          messages: input.messages.map(({ body }) => bodyForModel(body))
        }),
        path: AiPath.LlmFallback,
        tools: true,
        toolNames: REDIRECT_TOOLS
      });

      return { text, mutated: ctx.mutated };
    } catch (error) {
      if (error instanceof AiRequestError || ctx.mutated) {
        throw new TurnError(error instanceof Error ? error.message : 'Turn failed', !ctx.mutated);
      }

      throw error;
    }
  };
}
