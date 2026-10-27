import type { DbClient } from '../db';
import type { LlmTool } from './openrouter-client';
import type { MenuProduct } from '../menu/repository';
import type { Selection } from '../orders/pricing';
import type { DraftScope, Geocode } from '../orders/repository';

import { BillingRepository } from '../billing/repository';
import { ConversationRepository } from '../conversations/repository';
import { APPROVAL_REASONS, LIMIT_REASONS } from '../conversations/types';
import { searchMenu } from '../menu/search';
import { PricingError } from '../orders/pricing';
import { OrderError, OrderErrorCode, OrderRepository } from '../orders/repository';
import { Fulfillment } from '../orders/types';
import { StoreRepository } from '../stores/repository';
import { PaymentMethod } from '../stores/types';

export const enum ToolName {
  SearchMenu = 'search_menu',
  AddItem = 'add_item',
  RemoveItem = 'remove_item',
  SetFulfillment = 'set_fulfillment',
  SetAddress = 'set_address',
  UseSavedAddress = 'use_saved_address',
  SetPayment = 'set_payment',
  GetCart = 'get_cart',
  PlaceOrder = 'place_order',
  CallHuman = 'call_human',
  RepeatPreviousOrder = 'repeat_previous_order',
  AddToOrder = 'add_to_order'
}

export type ToolContext = DraftScope & {
  db: DbClient;
  menu: MenuProduct[];
  /**
   * Places a typed address for distance delivery; absent = never geocode.
   */
  geocode?: Geocode;
  /**
   * Set once a tool changed the order or the conversation: a failed turn must not be replayed after it.
   */
  mutated: boolean;
  /**
   * Set once a tool handed the conversation to a human: later tool calls in the turn are refused.
   */
  handedOff?: boolean;
  /**
   * What the store approved for the current order (`conversations.approved_reason`).
   */
  approvedReason?: string | null;
  /**
   * Set once a tool asked the store's approval: like `handedOff`, and the turn's reply is never sent.
   */
  awaitingApproval?: boolean;
};

/**
 * A person is needed: an approval reason pauses the bot for the store's decision, any other hands off.
 */
const escalate = async (ctx: ToolContext, reason: string) => {
  if (APPROVAL_REASONS.has(reason)) {
    await ConversationRepository.requestApproval(ctx.db, { conversationId: ctx.conversationId, reason });
    ctx.awaitingApproval = true;
  } else {
    await ConversationRepository.handOffToHuman(ctx.db, { conversationId: ctx.conversationId, reason });
  }

  ctx.handedOff = true;
};

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; message: string };

const MAX_MENU_RESULTS = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MUTATING_TOOLS = new Set<string>([
  ToolName.AddItem,
  ToolName.RemoveItem,
  ToolName.SetFulfillment,
  ToolName.SetAddress,
  ToolName.UseSavedAddress,
  ToolName.SetPayment,
  ToolName.PlaceOrder,
  ToolName.CallHuman,
  ToolName.RepeatPreviousOrder,
  ToolName.AddToOrder
]);

const ITEM_PROPERTIES = {
  product_id: { type: 'string' },
  qty: { type: 'integer', minimum: 1 },
  selections: {
    type: 'array',
    description: 'One entry per option group, with the chosen option ids (two flavors = half-and-half).',
    items: {
      type: 'object',
      properties: { group_id: { type: 'string' }, option_ids: { type: 'array', items: { type: 'string' } } },
      required: ['group_id', 'option_ids']
    }
  },
  notes: { type: 'string', description: 'Free notes, e.g. "sem cebola".' }
};

const tool = (
  name: ToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): LlmTool => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false }
  }
});

export const TOOL_DEFINITIONS: LlmTool[] = [
  tool(
    ToolName.SearchMenu,
    'Search the store menu. Returns products with ids, prices and option groups. Use it before add_item.',
    { query: { type: 'string', description: 'Words from the customer, e.g. "calabresa". Empty lists the menu.' } },
    []
  ),
  tool(ToolName.AddItem, 'Add a product to the order. Prices are computed by the system.', ITEM_PROPERTIES, [
    'product_id',
    'qty'
  ]),
  tool(
    ToolName.RemoveItem,
    'Remove an item from the order by its item_id from the cart.',
    { item_id: { type: 'string' } },
    ['item_id']
  ),
  tool(
    ToolName.SetFulfillment,
    'Set delivery or pickup.',
    { fulfillment: { type: 'string', enum: [Fulfillment.Delivery, Fulfillment.Pickup] } },
    ['fulfillment']
  ),
  tool(
    ToolName.SetAddress,
    'Set the delivery address (implies delivery).',
    {
      address: { type: 'string', description: 'Street, number and complement.' },
      neighborhood: { type: 'string' }
    },
    ['address', 'neighborhood']
  ),
  tool(
    ToolName.UseSavedAddress,
    "Deliver to the customer's previous delivery address (`saved_address`), after the customer agreed.",
    {},
    []
  ),
  tool(
    ToolName.SetPayment,
    'Set the payment method. For cash, change_for_cents is the bill the customer pays with, in cents.',
    {
      method: { type: 'string', enum: [PaymentMethod.Pix, PaymentMethod.Card, PaymentMethod.Cash] },
      change_for_cents: { type: 'integer', minimum: 0 }
    },
    ['method']
  ),
  tool(ToolName.GetCart, 'Get the current order with totals and what is still missing.', {}, []),
  tool(ToolName.PlaceOrder, 'Place the order. Only after the customer confirmed the summary and total.', {}, []),
  tool(
    ToolName.CallHuman,
    'Hand the conversation to a human attendant.',
    { reason: { type: 'string', description: 'Short reason, e.g. "customer_asked" or "complaint".' } },
    ['reason']
  ),
  tool(
    ToolName.RepeatPreviousOrder,
    "Add the items of the customer's previous order (`previous_order`) with today's prices, after the customer " +
      'accepted. Items no longer on the menu come back in `skipped`.',
    {},
    []
  ),
  tool(
    ToolName.AddToOrder,
    'Add a product to `last_order` while the store prepares it (`last_order.add_on`), after the customer confirmed ' +
      'the item, its price and the possible delay. Only products from `last_order.add_on.categories`.',
    ITEM_PROPERTIES,
    ['product_id', 'qty']
  )
];

class ToolArgumentError extends Error {
  constructor(
    public readonly code: 'invalid_arguments' | 'unknown_tool',
    message: string
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const invalid = (message: string) => new ToolArgumentError('invalid_arguments', message);

const optionalString = (args: Record<string, unknown>, key: string) => {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw invalid(`${key} must be a string`);
  }

  return value.trim() || undefined;
};

const requireString = (args: Record<string, unknown>, key: string) => {
  const value = optionalString(args, key);

  if (!value) {
    throw invalid(`${key} is required`);
  }

  return value;
};

const optionalInteger = (args: Record<string, unknown>, key: string, min: number) => {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw invalid(`${key} must be an integer >= ${min}`);
  }

  return value;
};

const requireEnum = <T extends string>(args: Record<string, unknown>, key: string, values: readonly T[]) => {
  const value = requireString(args, key);

  if (!values.includes(value as T)) {
    throw invalid(`${key} must be one of ${values.join(', ')}`);
  }

  return value as T;
};

const parseSelections = (value: unknown): Selection[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw invalid('selections must be a list');
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.group_id !== 'string' ||
      !Array.isArray(entry.option_ids) ||
      !entry.option_ids.every((id) => typeof id === 'string')
    ) {
      throw invalid('each selection needs group_id and option_ids');
    }

    return { group_id: entry.group_id, option_ids: entry.option_ids };
  });
};

const findProduct = (ctx: ToolContext, args: Record<string, unknown>) => {
  const productId = requireString(args, 'product_id');
  const product = ctx.menu.find(({ id }) => id === productId);

  if (!product) {
    throw new OrderError(OrderErrorCode.UnknownProduct, `Unknown product ${productId}`);
  }

  return product;
};

const parseLine = (ctx: ToolContext, args: Record<string, unknown>) => ({
  product: findProduct(ctx, args),
  qty: optionalInteger(args, 'qty', 1) ?? 1,
  selections: parseSelections(args.selections),
  notes: optionalString(args, 'notes') ?? null,
  skipLimits: !!ctx.approvedReason && LIMIT_REASONS.has(ctx.approvedReason)
});

const toMenuView = (product: MenuProduct) => ({
  product_id: product.id,
  name: product.name,
  category: product.category,
  description: product.description,
  price_cents: product.price_cents,
  sold_out: product.sold_out ?? false,
  groups: product.groups.map((group) => ({
    group_id: group.id,
    name: group.name,
    min: group.min,
    max: group.max,
    price_mode: group.price_mode,
    options: group.options
      .filter(({ active }) => active)
      .map(({ id, name, price_delta_cents, sold_out }) => ({
        option_id: id,
        name,
        price_delta_cents,
        sold_out: sold_out ?? false
      }))
  }))
});

const run = async (ctx: ToolContext, name: string, args: Record<string, unknown>) => {
  const { db } = ctx;

  switch (name) {
    case ToolName.SearchMenu: {
      const matches = searchMenu(ctx.menu, optionalString(args, 'query') ?? '');

      return { products: (matches.length ? matches : ctx.menu).slice(0, MAX_MENU_RESULTS).map(toMenuView) };
    }

    case ToolName.AddItem: {
      const line = parseLine(ctx, args);

      await OrderRepository.assertCanStartOrder(db, ctx);

      return { cart: await OrderRepository.addItem(db, ctx, line) };
    }

    case ToolName.AddToOrder: {
      const cart = await OrderRepository.addToAcceptedOrder(db, ctx, parseLine(ctx, args));
      const policy = await StoreRepository.getPolicy(db, ctx.storeId);

      return { cart, extra_minutes: policy.add_on_extra_minutes ?? null };
    }

    case ToolName.RemoveItem: {
      const itemId = requireString(args, 'item_id');

      // Checked after the order lookup so a missing order reports no_draft; a malformed id never reaches Postgres.
      const current = await OrderRepository.findCurrentOrder(db, ctx);

      if (current && !UUID_PATTERN.test(itemId)) {
        throw new OrderError(OrderErrorCode.ItemNotFound, `Item ${itemId} is not in the order`);
      }

      return { cart: await OrderRepository.removeItem(db, ctx, itemId) };
    }

    case ToolName.SetFulfillment: {
      const fulfillment = requireEnum(args, 'fulfillment', [Fulfillment.Delivery, Fulfillment.Pickup]);

      return { cart: await OrderRepository.setFulfillment(db, ctx, fulfillment) };
    }

    case ToolName.SetAddress: {
      return {
        cart: await OrderRepository.setAddress(
          db,
          ctx,
          {
            address: requireString(args, 'address'),
            neighborhood: optionalString(args, 'neighborhood') ?? null
          },
          ctx.geocode
        )
      };
    }

    case ToolName.UseSavedAddress: {
      return { cart: await OrderRepository.applySavedAddress(db, ctx, ctx.geocode) };
    }

    case ToolName.RepeatPreviousOrder: {
      const policy = await StoreRepository.getPolicy(db, ctx.storeId);
      const previous = await OrderRepository.findPreviousOrder(db, ctx, policy.repeat_order_statuses ?? []);

      if (!previous) {
        throw new OrderError(OrderErrorCode.NoPreviousOrder, 'There is no previous order to repeat');
      }

      await OrderRepository.assertCanStartOrder(db, ctx);

      const skipped: string[] = [];
      let cart: Awaited<ReturnType<typeof OrderRepository.addItem>> | undefined;

      for (const item of previous.items) {
        const product = ctx.menu.find(({ id }) => id === item.productId);

        if (!product) {
          skipped.push(item.name);
          continue;
        }

        try {
          cart = await OrderRepository.addItem(db, ctx, {
            product,
            qty: item.qty,
            selections: item.selections,
            notes: item.notes,
            skipLimits: !!ctx.approvedReason && LIMIT_REASONS.has(ctx.approvedReason)
          });

          // Lines already added stay: a later failure must not replay the tool and add them again.
          ctx.mutated = true;
        } catch (error) {
          // An option left the menu or the stock ran out: the item is skipped, the rest still comes back.
          if (
            error instanceof PricingError ||
            (error instanceof OrderError && error.code === OrderErrorCode.OutOfStock)
          ) {
            skipped.push(item.name);
            continue;
          }

          throw error;
        }
      }

      if (!cart) {
        throw new OrderError(OrderErrorCode.NoPreviousOrder, 'No item of the previous order is on the menu now');
      }

      return { cart, skipped };
    }

    case ToolName.SetPayment: {
      const method = requireEnum(args, 'method', [PaymentMethod.Pix, PaymentMethod.Card, PaymentMethod.Cash]);

      return {
        cart: await OrderRepository.setPayment(db, ctx, {
          method,
          changeForCents: optionalInteger(args, 'change_for_cents', 0) ?? null
        })
      };
    }

    case ToolName.GetCart: {
      const current = await OrderRepository.findCurrentOrder(db, ctx);

      return { cart: current ? await OrderRepository.getCart(db, current.id) : null };
    }

    case ToolName.PlaceOrder: {
      const cart = await OrderRepository.place(db, ctx);

      await BillingRepository.recordPlaced(db, {
        storeId: ctx.storeId,
        conversationId: ctx.conversationId,
        orderId: cart.order_id
      });

      if (!cart.review) {
        return { cart };
      }

      await escalate(ctx, 'new_customer_review');

      return { cart, handed_off: true };
    }

    case ToolName.CallHuman: {
      await escalate(ctx, optionalString(args, 'reason') ?? 'agent_requested');

      return { handed_off: true };
    }

    default:
      throw new ToolArgumentError('unknown_tool', `Unknown tool ${name}`);
  }
};

/**
 * Run one tool for the model. Domain and argument errors go back to the model as `{ ok: false }` (it can correct
 * itself); infrastructure errors throw.
 */
export const executeTool = async (ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> => {
  // The conversation is with a person now: the model only says goodbye.
  if (ctx.handedOff) {
    return { ok: false, error: 'needs_human', message: 'The conversation was handed to a human; do not call tools' };
  }

  try {
    if (!isRecord(args)) {
      throw invalid('arguments must be an object');
    }

    const data = await run(ctx, name, args);

    if (MUTATING_TOOLS.has(name)) {
      ctx.mutated = true;
    }

    return { ok: true, data };
  } catch (error) {
    // A limit that needs a person: code hands off, the model only says goodbye.
    if (error instanceof OrderError && error.handoffReason) {
      await escalate(ctx, error.handoffReason);

      ctx.mutated = true;

      return { ok: false, error: error.code, message: error.message };
    }

    if (error instanceof PricingError || error instanceof OrderError || error instanceof ToolArgumentError) {
      return { ok: false, error: error.code, message: error.message };
    }

    throw error;
  }
};
