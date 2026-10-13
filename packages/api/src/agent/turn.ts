import type { DbClient } from '../db';
import type { AgentStore, LastOrder } from './prompt';
import type { AgentEnv } from './router';
import type { ToolContext } from './tools';
import type { HourRange } from '../stores/hours';

import { AiRequestError, TurnError } from './errors';
import { HISTORY_LIMIT } from './prompt';
import { AgentRouter } from './router';
import { ConversationRepository } from '../conversations/repository';
import { MenuRepository } from '../menu/repository';
import { OrderRepository } from '../orders/repository';
import { OrderStatus } from '../orders/types';
import { isClosingSoon } from '../stores/hours';
import { orderMemorySince } from '../stores/policy';

export type TurnInput = {
  db: DbClient;
  env: AgentEnv;
  store: AgentStore;
  hours: HourRange[];
  conversationId: string;
  customerId: string;
  messages: { id: string; body: string }[];
};

/**
 * Orders the model can still talk about (the store has not finished them).
 */
const OPEN_STATUSES = new Set<OrderStatus>([OrderStatus.Placed, OrderStatus.Accepted, OrderStatus.Out]);

const describeLastOrder = async (
  db: DbClient,
  order: { id: string; status: OrderStatus; placedAt: string },
  now: Date
): Promise<LastOrder> => {
  const { items, total_cents } = await OrderRepository.getCart(db, order.id);

  return {
    order_id: order.id,
    items,
    total_cents,
    status: order.status,
    minutes_ago: Math.floor((now.getTime() - Date.parse(order.placedAt)) / 60_000),
    editable: order.status === OrderStatus.Placed
  };
};

export namespace TurnResponder {
  /**
   * Produce the reply for the pending customer messages. `mutated` tells the caller a replay would repeat a change.
   * AI failures become `TurnError`, retryable only while nothing changed; after a change, any failure does.
   */
  export const respond = async (input: TurnInput) => {
    const { db, store, conversationId } = input;

    const now = new Date();
    const memorySince = orderMemorySince(store.policy, now);

    const [menu, draftId, lastPlaced] = await Promise.all([
      MenuRepository.load(db, store.id),
      OrderRepository.findDraftId(db, conversationId),
      OrderRepository.findLastPlaced(db, conversationId)
    ]);

    const placedInWindow = !!lastPlaced && Date.parse(lastPlaced.placedAt) >= Date.parse(memorySince);

    // One thread per order: the model sees only messages after the last placed order, inside the memory window.
    const history = await ConversationRepository.recentMessages(db, {
      conversationId,
      limit: HISTORY_LIMIT,
      excludeIds: input.messages.map(({ id }) => id),
      since: lastPlaced && placedInWindow ? lastPlaced.placedAt : memorySince
    });

    const cart = draftId ? await OrderRepository.getCart(db, draftId) : undefined;

    const lastOrder =
      !draftId && lastPlaced && placedInWindow && OPEN_STATUSES.has(lastPlaced.status)
        ? await describeLastOrder(db, lastPlaced, now)
        : null;

    const lastOrderMinutes = store.policy?.last_order_minutes;
    const closingSoon = lastOrderMinutes != null && isClosingSoon(input.hours, store.timezone, now, lastOrderMinutes);

    const ctx: ToolContext = {
      db,
      storeId: store.id,
      conversationId,
      customerId: input.customerId,
      menu,
      mutated: false
    };

    try {
      const text = await AgentRouter.run({
        ctx,
        env: input.env,
        store,
        cart,
        history,
        messages: input.messages.map(({ body }) => body),
        lastOrder,
        closingSoon
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
