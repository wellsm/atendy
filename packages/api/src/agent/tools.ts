import type { DbClient } from '../db';
import type { LlmTool } from './openrouter-client';
import type { MenuProduct } from '../menu/repository';
import type { Selection } from '../orders/pricing';
import type { DraftScope } from '../orders/repository';

import { ConversationRepository } from '../conversations/repository';
import { searchMenu } from '../menu/search';
import { PricingError } from '../orders/pricing';
import { OrderError, OrderErrorCode, OrderRepository } from '../orders/repository';
import { Fulfillment } from '../orders/types';
import { PaymentMethod } from '../stores/types';

export const enum ToolName {
  SearchMenu = 'search_menu',
  AddItem = 'add_item',
  RemoveItem = 'remove_item',
  SetFulfillment = 'set_fulfillment',
  SetAddress = 'set_address',
  SetPayment = 'set_payment',
  GetCart = 'get_cart',
  PlaceOrder = 'place_order',
  CallHuman = 'call_human'
}

export type ToolContext = DraftScope & {
  db: DbClient;
  menu: MenuProduct[];
  /**
   * Set once a tool changed the order or the conversation: a failed turn must not be replayed after it.
   */
  mutated: boolean;
  /**
   * Set once a tool handed the conversation to a human: later tool calls in the turn are refused.
   */
  handedOff?: boolean;
};

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; message: string };

const MAX_MENU_RESULTS = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MUTATING_TOOLS = new Set<string>([
  ToolName.AddItem,
  ToolName.RemoveItem,
  ToolName.SetFulfillment,
  ToolName.SetAddress,
  ToolName.SetPayment,
  ToolName.PlaceOrder,
  ToolName.CallHuman
]);

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
  tool(
    ToolName.AddItem,
    'Add a product to the order. Prices are computed by the system.',
    {
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
    },
    ['product_id', 'qty']
  ),
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

const toMenuView = (product: MenuProduct) => ({
  product_id: product.id,
  name: product.name,
  category: product.category,
  description: product.description,
  price_cents: product.price_cents,
  groups: product.groups.map((group) => ({
    group_id: group.id,
    name: group.name,
    min: group.min,
    max: group.max,
    price_mode: group.price_mode,
    options: group.options
      .filter(({ active }) => active)
      .map(({ id, name, price_delta_cents }) => ({ option_id: id, name, price_delta_cents }))
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
      const productId = requireString(args, 'product_id');
      const product = ctx.menu.find(({ id }) => id === productId);

      if (!product) {
        throw new OrderError(OrderErrorCode.UnknownProduct, `Unknown product ${productId}`);
      }

      const cart = await OrderRepository.addItem(db, ctx, {
        product,
        qty: optionalInteger(args, 'qty', 1) ?? 1,
        selections: parseSelections(args.selections),
        notes: optionalString(args, 'notes') ?? null
      });

      return { cart };
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
        cart: await OrderRepository.setAddress(db, ctx, {
          address: requireString(args, 'address'),
          neighborhood: optionalString(args, 'neighborhood') ?? null
        })
      };
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

      if (!cart.review) {
        return { cart };
      }

      await ConversationRepository.handOffToHuman(db, {
        conversationId: ctx.conversationId,
        reason: 'new_customer_review'
      });

      ctx.handedOff = true;

      return { cart, handed_off: true };
    }

    case ToolName.CallHuman: {
      await ConversationRepository.handOffToHuman(db, {
        conversationId: ctx.conversationId,
        reason: optionalString(args, 'reason') ?? 'agent_requested'
      });

      ctx.handedOff = true;

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
      await ConversationRepository.handOffToHuman(ctx.db, {
        conversationId: ctx.conversationId,
        reason: error.handoffReason
      });

      ctx.mutated = true;
      ctx.handedOff = true;

      return { ok: false, error: error.code, message: error.message };
    }

    if (error instanceof PricingError || error instanceof OrderError || error instanceof ToolArgumentError) {
      return { ok: false, error: error.code, message: error.message };
    }

    throw error;
  }
};
