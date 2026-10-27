import type { DbClient } from '../db';
import type { AgentStore, LastOrder, PreviousOrder, SavedAddress } from './prompt';
import type { AgentEnv } from './router';
import type { ToolContext } from './tools';
import type { MenuProduct } from '../menu/repository';
import type { HourRange } from '../stores/hours';
import type { StorePolicy } from '../stores/types';

import { AiRequestError, TurnError } from './errors';
import { HISTORY_LIMIT } from './prompt';
import { AgentRouter } from './router';
import { ConversationRepository } from '../conversations/repository';
import { MessageAuthor } from '../conversations/types';
import { MenuRepository } from '../menu/repository';
import { addOnCategories, canStartNewOrder } from '../orders/in-progress';
import { OrderRepository } from '../orders/repository';
import { formatOrderSummary, SUMMARY_TOKEN } from '../orders/summary';
import { Fulfillment, OrderStatus } from '../orders/types';
import { locateWithGoogle } from '../stores/geocoding';
import { isClosingSoon } from '../stores/hours';
import { orderMemorySince } from '../stores/policy';
import { PreviousAddress } from '../stores/types';
import { bodyForModel, parseLocationBody } from '../whatsapp/location';

export type TurnInput = {
  db: DbClient;
  env: AgentEnv;
  store: AgentStore;
  hours: HourRange[];
  conversationId: string;
  customerId: string;
  messages: { id: string; body: string }[];
  /**
   * Public menu link of the store, sent when the customer asks for the menu.
   */
  menuUrl?: string;
  /**
   * What the store approved after the bot asked (`conversations.approved_reason`).
   */
  approvedReason?: string | null;
  /**
   * The store's fixed greeting goes out right before this reply: the model must not greet again.
   */
  greeted?: boolean;
};

/**
 * Orders the model can still talk about (the store has not finished them).
 */
const OPEN_STATUSES = new Set<OrderStatus>([OrderStatus.Placed, OrderStatus.Accepted, OrderStatus.Out]);

const describeLastOrder = async (
  db: DbClient,
  order: { id: string; status: OrderStatus; placedAt: string },
  context: { now: Date; policy: StorePolicy; menu: MenuProduct[] }
): Promise<LastOrder> => {
  const { items, total_cents } = await OrderRepository.getCart(db, order.id);

  // Categories on the menu today (a category without active products cannot be offered).
  const categories = [...new Map(context.menu.map(({ category_id, category }) => [category_id, category])).entries()];

  const addOn =
    order.status === OrderStatus.Accepted
      ? addOnCategories(
          context.policy,
          categories.map(([id, name]) => ({ id, name }))
        ).map(({ name }) => name)
      : [];

  return {
    order_id: order.id,
    items,
    total_cents,
    status: order.status,
    minutes_ago: Math.floor((context.now.getTime() - Date.parse(order.placedAt)) / 60_000),
    editable: order.status === OrderStatus.Placed,
    new_order_allowed: canStartNewOrder(order.status, context.policy),
    add_on: addOn.length ? { categories: addOn, extra_minutes: context.policy.add_on_extra_minutes ?? null } : null
  };
};

/**
 * Swaps the model's `[[resumo]]` for the current order's summary (the draft, else the order the turn placed or edited):
 * the model never rewrites items or prices.
 */
const fillSummary = async (db: DbClient, text: string, input: { conversationId: string; policy: StorePolicy }) => {
  if (!text.includes(SUMMARY_TOKEN)) {
    return text;
  }

  const draftId = await OrderRepository.findDraftId(db, input.conversationId);
  const orderId = draftId ?? (await OrderRepository.findLastPlaced(db, input.conversationId))?.id;

  const { delivery_min_minutes: min, delivery_max_minutes: max } = input.policy;

  const summary = orderId
    ? formatOrderSummary(await OrderRepository.getCart(db, orderId), { min: min ?? null, max: max ?? null })
    : '';

  return text.split(SUMMARY_TOKEN).join(summary);
};

export namespace TurnResponder {
  /**
   * Produce the reply for the pending customer messages. `mutated` tells the caller a replay would repeat a change;
   * `awaitingApproval` that the store must decide first (the reply is not sent).
   * AI failures become `TurnError`, retryable only while nothing changed; after a change, any failure does.
   */
  export const respond = async (input: TurnInput) => {
    const { db, store, conversationId } = input;

    const now = new Date();
    const memorySince = orderMemorySince(store.policy, now);
    const scope = { storeId: store.id, conversationId, customerId: input.customerId };

    // A shared WhatsApp location goes to the order in code, before the model: coordinates never pass through it.
    const pin = input.messages
      .map(({ body }) => parseLocationBody(body))
      .filter((location) => location !== undefined)
      .at(-1);

    if (pin) {
      await OrderRepository.setLocation(db, scope, pin);
    }

    // A draft left longer than the memory window is abandoned: the customer starts a new order.
    await OrderRepository.abandonIfStale(db, {
      conversationId,
      lastActivity: await ConversationRepository.lastActivityBefore(
        db,
        conversationId,
        input.messages.map(({ id }) => id)
      ),
      memorySince
    });

    const [menu, draftId, lastPlaced] = await Promise.all([
      MenuRepository.load(db, store.id),
      OrderRepository.findDraftId(db, conversationId),
      OrderRepository.findLastPlaced(db, conversationId)
    ]);

    const placedInWindow = !!lastPlaced && Date.parse(lastPlaced.placedAt) >= Date.parse(memorySince);

    // One thread per order: the model sees only messages after the last placed order, inside the memory window.
    const recent = await ConversationRepository.recentMessages(db, {
      conversationId,
      limit: HISTORY_LIMIT,
      excludeIds: input.messages.map(({ id }) => id),
      since: lastPlaced && placedInWindow ? lastPlaced.placedAt : memorySince
    });

    const history = recent.map((message) => ({ ...message, body: bodyForModel(message.body) }));

    const cart = draftId ? await OrderRepository.getCart(db, draftId) : undefined;

    const lastOrder =
      !draftId && lastPlaced && placedInWindow && OPEN_STATUSES.has(lastPlaced.status)
        ? await describeLastOrder(db, lastPlaced, { now, policy: store.policy ?? {}, menu })
        : null;

    const policy = store.policy ?? {};

    // Only while the order can still go to an address it does not have.
    const saved =
      cart?.fulfillment !== Fulfillment.Pickup && !cart?.address
        ? await OrderRepository.findSavedAddress(db, scope)
        : undefined;

    const savedAddress: SavedAddress | undefined = saved && {
      address: saved.address,
      neighborhood: saved.neighborhood,
      offer: policy.previous_address ?? PreviousAddress.Ask
    };

    // Offered once: at the start of a new order, before the bot said anything in this thread.
    const offerRepeat =
      !!policy.repeat_order_statuses?.length &&
      !draftId &&
      !lastOrder &&
      !recent.some(({ author }) => author === MessageAuthor.Bot);

    const previous = offerRepeat
      ? await OrderRepository.findPreviousOrder(db, scope, policy.repeat_order_statuses ?? [])
      : undefined;

    const previousOrder: PreviousOrder | undefined = previous && {
      items: previous.items.map(({ name, qty, options }) => ({ name, qty, options })),
      total_cents: previous.totalCents,
      days_ago: Math.floor((now.getTime() - Date.parse(previous.placedAt)) / 86_400_000)
    };

    const lastOrderMinutes = policy.last_order_minutes;
    const closingSoon = lastOrderMinutes != null && isClosingSoon(input.hours, store.timezone, now, lastOrderMinutes);

    const ctx: ToolContext = {
      ...scope,
      db,
      menu,
      mutated: false,
      approvedReason: input.approvedReason ?? null,
      geocode: locateWithGoogle(input.env.GOOGLE_MAPS_API_KEY)
    };

    try {
      const text = await AgentRouter.run({
        ctx,
        env: input.env,
        store,
        cart,
        history,
        messages: input.messages.map(({ body }) => bodyForModel(body)),
        lastOrder,
        closingSoon,
        menuUrl: input.menuUrl,
        approvedReason: input.approvedReason,
        savedAddress,
        previousOrder,
        greeted: input.greeted
      });

      return {
        text: await fillSummary(db, text, { conversationId, policy }),
        mutated: ctx.mutated,
        awaitingApproval: !!ctx.awaitingApproval
      };
    } catch (error) {
      if (error instanceof AiRequestError || ctx.mutated) {
        throw new TurnError(error instanceof Error ? error.message : 'Turn failed', !ctx.mutated);
      }

      throw error;
    }
  };
}
