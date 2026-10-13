import type { DbClient } from '../db';
import type { PricingProduct, Selection } from './pricing';
import type { OptionsSnapshot } from './types';
import type { StorePolicy } from '../stores/types';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { computeTotals, priceItem, validateChange } from './pricing';
import { canTransition } from './status';
import { Fulfillment, OrderStatus } from './types';
import { resolveDeliveryFee } from '../stores/delivery';
import { isClosingSoon } from '../stores/hours';
import { orderMemorySince } from '../stores/policy';
import { StoreRepository } from '../stores/repository';
import { DeliveryMode, PaymentMethod } from '../stores/types';

export const enum OrderErrorCode {
  UnknownProduct = 'unknown_product',
  ItemNotFound = 'item_not_found',
  NoDraft = 'no_draft',
  Incomplete = 'incomplete',
  PaymentNotAccepted = 'payment_not_accepted',
  NeedsHuman = 'needs_human',
  OrderLocked = 'order_locked',
  ChangeTooHigh = 'change_too_high',
  StoreClosing = 'store_closing'
}

export class OrderError extends Error {
  constructor(
    public readonly code: OrderErrorCode,
    message: string,
    /**
     * Set when a human must take over: the tool hands the conversation off with this reason.
     */
    public readonly handoffReason?: string
  ) {
    super(message);
  }
}

export const enum OrderStatusErrorCode {
  NotFound = 'not_found',
  InvalidTransition = 'invalid_transition'
}

/**
 * A status change the store asked for from the panel that cannot happen.
 */
export class OrderStatusError extends Error {
  constructor(
    public readonly code: OrderStatusErrorCode,
    message: string
  ) {
    super(message);
  }
}

export const enum PanelOrderScope {
  Open = 'open',
  Closed = 'closed'
}

export const enum CartMissing {
  Items = 'items',
  MinimumOrder = 'minimum_order',
  Fulfillment = 'fulfillment',
  Address = 'address',
  DeliveryArea = 'delivery_area',
  Payment = 'payment'
}

export type DraftScope = {
  storeId: string;
  conversationId: string;
  customerId: string;
};

export type CartItem = {
  item_id: string;
  name: string;
  qty: number;
  options: string;
  unit_price_cents: number;
  line_total_cents: number;
  notes: string | null;
};

export type Cart = {
  order_id: string;
  status: OrderStatus;
  items: CartItem[];
  fulfillment: Fulfillment | null;
  address: string | null;
  neighborhood: string | null;
  payment_method: PaymentMethod | null;
  change_for_cents: number | null;
  subtotal_cents: number;
  fee_cents: number;
  total_cents: number;
  missing: CartMissing[];
};

/**
 * The order the tools act on.
 */
export type CurrentOrder = {
  id: string;
  status: OrderStatus.Draft | OrderStatus.Placed;
};

type OrderWrite = (client: DbClient, orderId: string, status: CurrentOrder['status']) => Promise<void>;

const describeOptions = (snapshot: OptionsSnapshot) => {
  return snapshot
    .map(({ group_name, options }) => `${group_name}: ${options.map(({ name }) => name).join(' / ')}`)
    .join('; ');
};

const PANEL_OPEN_STATUSES = [OrderStatus.Placed, OrderStatus.Accepted, OrderStatus.Out];

const PANEL_CLOSED_STATUSES = [OrderStatus.Done, OrderStatus.Canceled];

const PANEL_CLOSED_LIMIT = 50;

const PANEL_ORDER_FIELDS = {
  id: true,
  status: true,
  customer_id: true,
  conversation_id: true,
  fulfillment: true,
  address: true,
  neighborhood: true,
  payment_method: true,
  change_for_cents: true,
  subtotal_cents: true,
  fee_cents: true,
  total_cents: true,
  placed_at: true,
  amended_at: true
} as const;

const OPEN_ORDER_STATUSES = [OrderStatus.Placed, OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done];

/**
 * Cash change must cover the total and stay within the store limit.
 */
const checkChange = (totalCents: number, changeForCents: number | null, policy: StorePolicy) => {
  validateChange(totalCents, changeForCents);

  const max = policy.max_change_cents;

  if (changeForCents !== null && max != null && changeForCents - totalCents > max) {
    throw new OrderError(OrderErrorCode.ChangeTooHigh, `Change above the store limit of ${max} cents`);
  }
};

const sumSubtotal = async (db: DbClient, orderId: string) => {
  const { records } = await db.order_items.findMany({
    select: { qty: true, unit_price_cents: true },
    where: { order_id: orderId }
  });

  return computeTotals(records, 0).subtotal_cents;
};

export namespace OrderRepository {
  /**
   * The conversation's open draft order (the cart), if any.
   */
  export const findDraftId = async (db: DbClient, conversationId: string) => {
    const conversation = await db.conversations.findOne({
      select: { draft_order_id: true },
      where: { id: conversationId }
    });

    if (!conversation?.draft_order_id) {
      return undefined;
    }

    const order = await db.orders.findOne({ select: { status: true }, where: { id: conversation.draft_order_id } });

    return order?.status === OrderStatus.Draft ? conversation.draft_order_id : undefined;
  };

  const createDraft = async (db: DbClient, scope: DraftScope) => {
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.orders.insertOne({
      data: {
        id,
        store_id: scope.storeId,
        customer_id: scope.customerId,
        conversation_id: scope.conversationId,
        status: OrderStatus.Draft,
        subtotal_cents: 0,
        fee_cents: 0,
        total_cents: 0,
        created_at: now,
        updated_at: now
      }
    });

    await db.conversations.updateOne({ data: { draft_order_id: id }, where: { id: scope.conversationId } });

    return id;
  };

  /**
   * The conversation's most recently placed order (any status after draft).
   */
  export const findLastPlaced = async (db: DbClient, conversationId: string) => {
    const {
      records: [order]
    } = await db.orders.findMany({
      select: { id: true, status: true, placed_at: true },
      where: { conversation_id: conversationId, placed_at: { isNull: false } },
      order: { placed_at: Order.Desc },
      take: 1
    });

    return order?.placed_at ? { id: order.id, status: order.status, placedAt: order.placed_at } : undefined;
  };

  /**
   * The draft, else the placed order the store has not accepted yet, still inside the store's memory window
   * ("esqueci a coca").
   */
  export const findCurrentOrder = async (db: DbClient, scope: DraftScope): Promise<CurrentOrder | undefined> => {
    const draftId = await findDraftId(db, scope.conversationId);

    if (draftId) {
      return { id: draftId, status: OrderStatus.Draft };
    }

    const [last, policy] = await Promise.all([
      findLastPlaced(db, scope.conversationId),
      StoreRepository.getPolicy(db, scope.storeId)
    ]);

    if (
      last?.status !== OrderStatus.Placed ||
      Date.parse(last.placedAt) < Date.parse(orderMemorySince(policy, new Date()))
    ) {
      return undefined;
    }

    return { id: last.id, status: OrderStatus.Placed };
  };

  /**
   * Runs `write` on a placed order only while the store has not accepted it. The row is locked and its status
   * checked in one transaction, so a store accepting at the same moment either waits or wins.
   */
  export const editPlacedOrder = async (db: DbClient, orderId: string, write: (tx: DbClient) => Promise<void>) => {
    await db.transaction(async (tx) => {
      const order = await tx.orders.findOne({ select: { status: true }, where: { id: orderId }, lock: true });

      if (order?.status !== OrderStatus.Placed) {
        throw new OrderError(
          OrderErrorCode.OrderLocked,
          'The store already accepted this order',
          'order_already_accepted'
        );
      }

      await write(tx);

      // Totals land in the same commit: a store accepting right after must not see the old total.
      await getCart(tx, orderId);

      const now = new Date().toISOString();

      await tx.orders.updateOne({ data: { amended_at: now, updated_at: now }, where: { id: orderId } });
    });
  };

  /**
   * Runs `write` on the current order. With no order, a draft is created when `create` is set; otherwise
   * `no_draft`. A placed order is changed only through `editPlacedOrder`. Returns the order id.
   */
  const writeCurrentOrder = async (db: DbClient, scope: DraftScope, create: boolean, write: OrderWrite) => {
    const current = await findCurrentOrder(db, scope);

    if (current?.status === OrderStatus.Placed) {
      await editPlacedOrder(db, current.id, (tx) => write(tx, current.id, OrderStatus.Placed));

      return current.id;
    }

    if (!current && !create) {
      throw new OrderError(OrderErrorCode.NoDraft, 'There is no open order');
    }

    const orderId = current?.id ?? (await createDraft(db, scope));

    await write(db, orderId, OrderStatus.Draft);

    return orderId;
  };

  /**
   * Recompute fee and totals from the stored items, persist them and return the cart.
   */
  export const getCart = async (db: DbClient, orderId: string): Promise<Cart> => {
    const order = await db.orders.findOne({
      select: {
        id: true,
        store_id: true,
        status: true,
        fulfillment: true,
        address: true,
        neighborhood: true,
        payment_method: true,
        change_for_cents: true
      },
      where: { id: orderId }
    });

    if (!order) {
      throw new OrderError(OrderErrorCode.NoDraft, 'There is no open order');
    }

    const [{ records: items }, store, { records: zones }] = await Promise.all([
      db.order_items.findMany({
        select: {
          id: true,
          product_name: true,
          qty: true,
          unit_price_cents: true,
          options_snapshot: true,
          notes: true
        },
        where: { order_id: orderId },
        order: { created_at: Order.Asc }
      }),
      db.stores.findOne({
        select: { delivery_mode: true, flat_fee_cents: true, policy: true },
        where: { id: order.store_id }
      }),
      db.delivery_zones.findMany({
        select: { neighborhood: true, fee_cents: true },
        where: { store_id: order.store_id }
      })
    ]);

    if (!store) {
      throw new OrderError(OrderErrorCode.NoDraft, 'Store not found');
    }

    const fee = order.fulfillment
      ? resolveDeliveryFee({
          fulfillment: order.fulfillment,
          deliveryMode: store.delivery_mode,
          flatFeeCents: store.flat_fee_cents,
          zones,
          neighborhood: order.neighborhood
        })
      : 0;

    const totals = computeTotals(items, fee ?? 0);

    const missing: CartMissing[] = [];

    if (!items.length) {
      missing.push(CartMissing.Items);
    }

    const minOrderCents = store.policy?.min_order_cents;

    if (items.length && minOrderCents != null && totals.subtotal_cents < minOrderCents) {
      missing.push(CartMissing.MinimumOrder);
    }

    if (!order.fulfillment) {
      missing.push(CartMissing.Fulfillment);
    }

    if (order.fulfillment === Fulfillment.Delivery) {
      if (!order.address || (store.delivery_mode === DeliveryMode.ByZone && !order.neighborhood)) {
        missing.push(CartMissing.Address);
      } else if (fee === undefined) {
        missing.push(CartMissing.DeliveryArea);
      }
    }

    if (!order.payment_method) {
      missing.push(CartMissing.Payment);
    }

    // Totals of an order the store already took stay as they were.
    if (order.status === OrderStatus.Draft || order.status === OrderStatus.Placed) {
      await db.orders.updateOne({
        data: { ...totals, updated_at: new Date().toISOString() },
        where: { id: orderId }
      });
    }

    return {
      order_id: order.id,
      status: order.status,
      items: items.map((item) => ({
        item_id: item.id,
        name: item.product_name,
        qty: item.qty,
        options: describeOptions(item.options_snapshot),
        unit_price_cents: item.unit_price_cents,
        line_total_cents: item.qty * item.unit_price_cents,
        notes: item.notes ?? null
      })),
      fulfillment: order.fulfillment ?? null,
      address: order.address ?? null,
      neighborhood: order.neighborhood ?? null,
      payment_method: order.payment_method ?? null,
      change_for_cents: order.change_for_cents ?? null,
      ...totals,
      missing
    };
  };

  /**
   * Prices the item and checks the store limits first: a refused item never creates a draft or a row.
   */
  export const addItem = async (
    db: DbClient,
    scope: DraftScope,
    input: { product: PricingProduct; qty: number; selections: Selection[]; notes?: string | null }
  ) => {
    const { unit_price_cents, options_snapshot } = priceItem(input.product, input.selections);

    const policy = await StoreRepository.getPolicy(db, scope.storeId);
    const lineCents = unit_price_cents * input.qty;
    const maxOrderCents = policy.max_order_cents;

    if (policy.max_item_qty != null && input.qty > policy.max_item_qty) {
      throw new OrderError(
        OrderErrorCode.NeedsHuman,
        `Quantity above the store limit of ${policy.max_item_qty}`,
        'qty_limit'
      );
    }

    const orderLimit = () =>
      new OrderError(OrderErrorCode.NeedsHuman, `Order above the store limit of ${maxOrderCents} cents`, 'order_limit');

    if (maxOrderCents != null && lineCents > maxOrderCents) {
      throw orderLimit();
    }

    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      if (maxOrderCents != null && (await sumSubtotal(client, id)) + lineCents > maxOrderCents) {
        throw orderLimit();
      }

      await client.order_items.insertOne({
        data: {
          id: randomUUID(),
          store_id: scope.storeId,
          order_id: id,
          product_id: input.product.id,
          product_name: input.product.name,
          qty: input.qty,
          unit_price_cents,
          options_snapshot,
          notes: input.notes ?? null,
          created_at: new Date().toISOString()
        }
      });
    });

    return getCart(db, orderId);
  };

  export const removeItem = async (db: DbClient, scope: DraftScope, itemId: string) => {
    const orderId = await writeCurrentOrder(db, scope, false, async (client, id, status) => {
      const { records: items } = await client.order_items.findMany({ select: { id: true }, where: { order_id: id } });

      if (!items.some((item) => item.id === itemId)) {
        throw new OrderError(OrderErrorCode.ItemNotFound, `Item ${itemId} is not in the order`);
      }

      // Emptying an order the store already received is a cancellation: the store decides.
      if (status === OrderStatus.Placed && items.length === 1) {
        throw new OrderError(OrderErrorCode.NeedsHuman, 'Removing the last item cancels the order', 'cancel_request');
      }

      await client.order_items.deleteMany({ where: { id: itemId } });
    });

    return getCart(db, orderId);
  };

  export const setFulfillment = async (db: DbClient, scope: DraftScope, fulfillment: Fulfillment) => {
    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      await client.orders.updateOne({ data: { fulfillment }, where: { id } });
    });

    return getCart(db, orderId);
  };

  /**
   * An address means delivery.
   */
  export const setAddress = async (
    db: DbClient,
    scope: DraftScope,
    input: { address: string; neighborhood: string | null }
  ) => {
    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      await client.orders.updateOne({
        data: { fulfillment: Fulfillment.Delivery, address: input.address, neighborhood: input.neighborhood },
        where: { id }
      });
    });

    return getCart(db, orderId);
  };

  /**
   * Change is kept only for cash and must cover the current total (checked again when placing).
   */
  export const setPayment = async (
    db: DbClient,
    scope: DraftScope,
    input: { method: PaymentMethod; changeForCents?: number | null }
  ) => {
    const store = await db.stores.findOne({
      select: { payment_methods: true, policy: true },
      where: { id: scope.storeId }
    });

    if (!store?.payment_methods.includes(input.method)) {
      throw new OrderError(OrderErrorCode.PaymentNotAccepted, `${input.method} is not accepted by the store`);
    }

    const changeForCents = input.method === PaymentMethod.Cash ? (input.changeForCents ?? null) : null;

    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      const { total_cents } = await getCart(client, id);

      checkChange(total_cents, changeForCents, store.policy ?? {});

      await client.orders.updateOne({
        data: { payment_method: input.method, change_for_cents: changeForCents },
        where: { id }
      });
    });

    return getCart(db, orderId);
  };

  /**
   * Places the draft. On a placed order (customer came back to change it), confirms the changes: it is validated
   * again and stays placed; the closing cutoff and the new-customer review apply only to the first placement.
   */
  export const place = async (db: DbClient, scope: DraftScope) => {
    const current = await findCurrentOrder(db, scope);

    if (!current) {
      throw new OrderError(OrderErrorCode.NoDraft, 'There is no open order');
    }

    const [cart, store, { records: hours }] = await Promise.all([
      getCart(db, current.id),
      db.stores.findOne({ select: { timezone: true, policy: true }, where: { id: scope.storeId } }),
      db.store_hours.findMany({
        select: { weekday: true, opens_at: true, closes_at: true },
        where: { store_id: scope.storeId }
      })
    ]);

    const policy = store?.policy ?? {};

    if (cart.missing.length) {
      throw new OrderError(OrderErrorCode.Incomplete, `Order is missing: ${cart.missing.join(', ')}`);
    }

    checkChange(cart.total_cents, cart.change_for_cents, policy);

    if (current.status === OrderStatus.Placed) {
      return { ...cart, review: false };
    }

    const lastOrderMinutes = policy.last_order_minutes;

    if (store && lastOrderMinutes != null && isClosingSoon(hours, store.timezone, new Date(), lastOrderMinutes)) {
      throw new OrderError(
        OrderErrorCode.StoreClosing,
        `The store stops taking orders ${lastOrderMinutes} minutes before closing`
      );
    }

    // A new customer's large first order goes to a person before the kitchen trusts it.
    const reviewCents = policy.new_customer_review_cents;

    const review =
      reviewCents != null &&
      cart.total_cents > reviewCents &&
      !(await db.orders.count({
        where: { customer_id: scope.customerId, status: { isIn: OPEN_ORDER_STATUSES } }
      }));

    const now = new Date().toISOString();

    await db.orders.updateOne({
      data: { status: OrderStatus.Placed, placed_at: now, updated_at: now },
      where: { id: current.id }
    });

    await db.conversations.updateOne({ data: { draft_order_id: null }, where: { id: scope.conversationId } });

    if (cart.fulfillment === Fulfillment.Delivery && cart.address) {
      await db.customers.updateOne({
        data: { last_address: cart.address, updated_at: now },
        where: { id: scope.customerId }
      });
    }

    return { ...cart, status: OrderStatus.Placed, review };
  };

  /**
   * Store move from the panel. Locks the order like `editPlacedOrder`, so an agent edit and an accept never
   * interleave. Returns what the customer notification needs.
   */
  export const setStatus = async (db: DbClient, input: { storeId: string; orderId: string; status: OrderStatus }) => {
    return db.transaction(async (tx) => {
      const order = await tx.orders.findOne({
        select: { store_id: true, status: true, conversation_id: true, fulfillment: true },
        where: { id: input.orderId },
        lock: true
      });

      // A draft is still the customer's cart: the panel never sees it.
      if (!order || order.store_id !== input.storeId || order.status === OrderStatus.Draft) {
        throw new OrderStatusError(OrderStatusErrorCode.NotFound, 'Order not found');
      }

      if (!canTransition(order.status, input.status)) {
        throw new OrderStatusError(
          OrderStatusErrorCode.InvalidTransition,
          `Order cannot go from ${order.status} to ${input.status}`
        );
      }

      await tx.orders.updateOne({
        data: { status: input.status, updated_at: new Date().toISOString() },
        where: { id: input.orderId }
      });

      return { conversationId: order.conversation_id, fulfillment: order.fulfillment ?? null };
    });
  };

  type PanelOrderRow = Awaited<ReturnType<typeof findPanelOrders>>[number];

  const findPanelOrders = async (db: DbClient, storeId: string, scope: PanelOrderScope) => {
    const open = scope === PanelOrderScope.Open;

    const { records } = await db.orders.findMany({
      select: PANEL_ORDER_FIELDS,
      where: { store_id: storeId, status: { isIn: open ? PANEL_OPEN_STATUSES : PANEL_CLOSED_STATUSES } },
      order: { placed_at: open ? Order.Asc : Order.Desc },
      ...(!open && { take: PANEL_CLOSED_LIMIT })
    });

    return records;
  };

  /**
   * Attaches items and customer with one query each.
   */
  const withDetails = async (db: DbClient, orders: PanelOrderRow[]) => {
    if (!orders.length) {
      return [];
    }

    const [{ records: items }, { records: customers }] = await Promise.all([
      db.order_items.findMany({
        select: {
          id: true,
          order_id: true,
          product_name: true,
          qty: true,
          unit_price_cents: true,
          options_snapshot: true,
          notes: true
        },
        where: { order_id: { isIn: orders.map(({ id }) => id) } },
        order: { created_at: Order.Asc }
      }),
      db.customers.findMany({
        select: { id: true, name: true, phone: true },
        where: { id: { isIn: [...new Set(orders.map(({ customer_id }) => customer_id))] } }
      })
    ]);

    return orders.map((order) => {
      const customer = customers.find(({ id }) => id === order.customer_id);

      return {
        ...order,
        customer: { name: customer?.name ?? null, phone: customer?.phone ?? '' },
        items: items
          .filter(({ order_id }) => order_id === order.id)
          .map((item) => ({
            id: item.id,
            product_name: item.product_name,
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            options: describeOptions(item.options_snapshot),
            notes: item.notes ?? null
          }))
      };
    });
  };

  export type PanelOrder = Awaited<ReturnType<typeof withDetails>>[number];

  /**
   * Open: the kitchen queue, oldest first. Closed: the latest finished or canceled orders.
   */
  export const listForPanel = async (db: DbClient, storeId: string, scope: PanelOrderScope) => {
    return withDetails(db, await findPanelOrders(db, storeId, scope));
  };

  export const getForPanel = async (db: DbClient, storeId: string, orderId: string) => {
    const order = await db.orders.findOne({
      select: { ...PANEL_ORDER_FIELDS, store_id: true },
      where: { id: orderId }
    });

    if (!order || order.store_id !== storeId) {
      return undefined;
    }

    const { store_id: _storeId, ...row } = order;
    const [detailed] = await withDetails(db, [row]);

    return detailed;
  };
}
