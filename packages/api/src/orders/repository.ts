import type { DbClient } from '../db';
import type { PricingProduct, Selection } from './pricing';
import type { Discount, OptionsSnapshot } from './types';
import type { Coordinates } from '../stores/geo';
import type { StorePolicy } from '../stores/types';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { displayOrderCode, nextOrderCodeIn } from './code';
import { OrderError, OrderErrorCode } from './errors';
import { addOnCategories, canStartNewOrder, DEFAULT_NEW_ORDER_AFTER_STATUS } from './in-progress';
import { computeTotals, lineTotal, priceItem, validateChange } from './pricing';
import { canTransition } from './status';
import { Fulfillment, OrderSource, OrderStatus } from './types';
import { CashRepository } from '../cash/repository';
import { syncOrderStock } from '../stock/order-stock';
import { StockRepository } from '../stock/repository';
import { resolveDeliveryFee } from '../stores/delivery';
import { distanceMeters, pickBandFee } from '../stores/geo';
import { isClosingSoon } from '../stores/hours';
import { orderMemorySince } from '../stores/policy';
import { StoreRepository } from '../stores/repository';
import { DeliveryMode, PaymentMethod } from '../stores/types';
export { OrderError, OrderErrorCode } from './errors';

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
  /**
   * Distance delivery: no customer location yet (pin or geocoded address).
   */
  Location = 'location',
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
  /**
   * After the line's own discount.
   */
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
  discount_cents: number;
  fee_cents: number;
  surcharge_cents: number;
  total_cents: number;
  /**
   * Straight-line distance to the store, one decimal; only in distance delivery once known.
   */
  distance_km?: number;
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

const PANEL_ABANDONED_LIMIT = 20;

const PANEL_ORDER_FIELDS = {
  id: true,
  code: true,
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
  abandoned_at: true,
  amended_at: true,
  source: true,
  customer_name: true
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

export type NewLine = {
  product: PricingProduct;
  qty: number;
  selections: Selection[];
  notes?: string | null;
  /**
   * POS: the line's own discount.
   */
  discount?: Discount | null;
  skipLimits?: boolean;
  /**
   * The attendant writes it: stock never refuses it (the balance may go negative).
   */
  byStaff?: boolean;
};

/**
 * Prices one new line and checks the store limits on it. The returned `write` checks the order total against the
 * stored items again and inserts the line (run it inside the order's write).
 */
export const prepareLine = async (db: DbClient, storeId: string, input: NewLine) => {
  const { unit_price_cents, options_snapshot } = priceItem(input.product, input.selections, {
    allowSoldOut: input.byStaff
  });

  const policy: StorePolicy = input.skipLimits ? {} : await StoreRepository.getPolicy(db, storeId);
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

  // What one unit uses now, frozen on the line: later link changes never move this order's stock.
  const stockUsage = await StockRepository.usageFor(db, storeId, {
    productId: input.product.id,
    optionIds: options_snapshot.flatMap(({ options }) => options.map(({ id }) => id))
  });

  return async (client: DbClient, orderId: string) => {
    if (maxOrderCents != null && (await sumSubtotal(client, orderId)) + lineCents > maxOrderCents) {
      throw orderLimit();
    }

    await client.order_items.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        order_id: orderId,
        product_id: input.product.id,
        product_name: input.product.name,
        qty: input.qty,
        unit_price_cents,
        options_snapshot,
        notes: input.notes ?? null,
        discount: input.discount ?? null,
        stock_usage: stockUsage,
        created_at: new Date().toISOString()
      }
    });
  };
};

const sumSubtotal = async (db: DbClient, orderId: string) => {
  const { records } = await db.order_items.findMany({
    select: { qty: true, unit_price_cents: true, discount: true },
    where: { order_id: orderId }
  });

  return computeTotals(records, 0).subtotal_cents;
};

/**
 * Finds the coordinates of a typed address near the store; undefined when it cannot be placed.
 */
export type Geocode = (query: string, near: Coordinates) => Promise<Coordinates | undefined>;

/**
 * Store coordinates when it delivers by distance.
 */
const distanceOrigin = async (db: DbClient, storeId: string) => {
  const store = await db.stores.findOne({ select: { delivery_mode: true }, where: { id: storeId } });

  return store?.delivery_mode === DeliveryMode.ByDistance ? StoreRepository.getStoreLocation(db, storeId) : undefined;
};

const locationData = (origin: Coordinates, location: Coordinates) => ({
  latitude: location.latitude,
  longitude: location.longitude,
  distance_meters: distanceMeters(origin, location)
});

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
   * checked in one transaction, so a store accepting at the same moment either waits or wins. The order's stock follows
   * the new lines in the same commit; only `byStaff` writes may take more than the balance.
   */
  export const editPlacedOrder = async (
    db: DbClient,
    orderId: string,
    write: (tx: DbClient) => Promise<void>,
    options: { byStaff?: boolean } = {}
  ) => {
    await db.transaction(async (tx) => {
      const order = await tx.orders.findOne({
        select: { status: true, store_id: true },
        where: { id: orderId },
        lock: true
      });

      if (order?.status !== OrderStatus.Placed) {
        throw new OrderError(
          OrderErrorCode.OrderLocked,
          'The store already accepted this order',
          'order_already_accepted'
        );
      }

      await write(tx);
      await syncOrderStock(tx, { storeId: order.store_id, orderId, enforce: !options.byStaff });

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
  const writeCurrentOrder = async (
    db: DbClient,
    scope: DraftScope,
    create: boolean,
    write: OrderWrite,
    options: { byStaff?: boolean } = {}
  ) => {
    const current = await findCurrentOrder(db, scope);

    if (current?.status === OrderStatus.Placed) {
      await editPlacedOrder(db, current.id, (tx) => write(tx, current.id, OrderStatus.Placed), options);

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
        change_for_cents: true,
        distance_meters: true,
        discount: true,
        surcharge_cents: true
      },
      where: { id: orderId }
    });

    if (!order) {
      throw new OrderError(OrderErrorCode.NoDraft, 'There is no open order');
    }

    const [{ records: items }, store, { records: zones }, bands] = await Promise.all([
      db.order_items.findMany({
        select: {
          id: true,
          product_name: true,
          qty: true,
          unit_price_cents: true,
          discount: true,
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
      }),
      StoreRepository.getBands(db, order.store_id)
    ]);

    if (!store) {
      throw new OrderError(OrderErrorCode.NoDraft, 'Store not found');
    }

    const byDistance = store.delivery_mode === DeliveryMode.ByDistance;
    const distance = order.distance_meters ?? null;

    const fee = !order.fulfillment
      ? 0
      : byDistance && order.fulfillment === Fulfillment.Delivery
        ? distance === null
          ? undefined
          : pickBandFee(bands, distance)
        : resolveDeliveryFee({
            fulfillment: order.fulfillment,
            deliveryMode: store.delivery_mode,
            flatFeeCents: store.flat_fee_cents,
            zones,
            neighborhood: order.neighborhood
          });

    const totals = computeTotals(items, fee ?? 0, {
      discount: order.discount,
      surchargeCents: order.surcharge_cents
    });

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
      }

      if (byDistance && distance === null) {
        missing.push(CartMissing.Location);
      } else if ((byDistance || order.address) && fee === undefined) {
        // A far pin is out of area right away, before the customer types an address.
        missing.push(CartMissing.DeliveryArea);
      }
    }

    if (!order.payment_method) {
      missing.push(CartMissing.Payment);
    }

    // Totals of an order the store already took stay as they were.
    if (order.status === OrderStatus.Draft || order.status === OrderStatus.Placed) {
      await db.orders.updateOne({
        data: {
          subtotal_cents: totals.subtotal_cents,
          fee_cents: totals.fee_cents,
          total_cents: totals.total_cents,
          updated_at: new Date().toISOString()
        },
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
        line_total_cents: lineTotal(item),
        notes: item.notes ?? null
      })),
      fulfillment: order.fulfillment ?? null,
      address: order.address ?? null,
      neighborhood: order.neighborhood ?? null,
      payment_method: order.payment_method ?? null,
      change_for_cents: order.change_for_cents ?? null,
      ...totals,
      ...(byDistance && distance !== null && { distance_km: Math.round(distance / 100) / 10 }),
      missing
    };
  };

  /**
   * Prices the item and checks the store limits first: a refused item never creates a draft or a row. `skipLimits`:
   * the store approved going over them for this order.
   */
  export const addItem = async (db: DbClient, scope: DraftScope, input: NewLine) => {
    const writeLine = await prepareLine(db, scope.storeId, input);
    const orderId = await writeCurrentOrder(db, scope, true, writeLine, { byStaff: input.byStaff });

    return getCart(db, orderId);
  };

  /**
   * The conversation's last placed order inside the memory window, with the store policy.
   */
  const lastPlacedInWindow = async (db: DbClient, scope: DraftScope) => {
    const [last, policy] = await Promise.all([
      findLastPlaced(db, scope.conversationId),
      StoreRepository.getPolicy(db, scope.storeId)
    ]);

    const inWindow = last && Date.parse(last.placedAt) >= Date.parse(orderMemorySince(policy, new Date()));

    return { last: inWindow ? last : undefined, policy };
  };

  /**
   * For the bot only (attendants and web orders are not gated): with no current order, a new one may start only
   * once the last placed order reached the store's `new_order_after_status`.
   */
  export const assertCanStartOrder = async (db: DbClient, scope: DraftScope) => {
    if (await findCurrentOrder(db, scope)) {
      return;
    }

    const { last, policy } = await lastPlacedInWindow(db, scope);

    if (last && !canStartNewOrder(last.status, policy)) {
      throw new OrderError(
        OrderErrorCode.PreviousOrderOpen,
        `The previous order is ${last.status}; the store takes a new order once it is ${policy.new_order_after_status ?? DEFAULT_NEW_ORDER_AFTER_STATUS}`
      );
    }
  };

  /**
   * Adds one line to the last order while the store prepares it (`accepted`), if its category is an add-on category.
   * Locked like `editPlacedOrder`, so a status change and an addition never interleave.
   */
  export const addToAcceptedOrder = async (
    db: DbClient,
    scope: DraftScope,
    input: NewLine & { product: PricingProduct & { category_id: string } }
  ) => {
    const { last, policy } = await lastPlacedInWindow(db, scope);

    if (last?.status !== OrderStatus.Accepted) {
      throw new OrderError(OrderErrorCode.NoOrderInProgress, 'There is no order being prepared to add to');
    }

    const { records: categories } = await db.categories.findMany({
      select: { id: true, name: true },
      where: { store_id: scope.storeId }
    });

    const allowed = addOnCategories(policy, categories);

    if (!allowed.some(({ id }) => id === input.product.category_id)) {
      throw new OrderError(
        OrderErrorCode.NotAllowedAfterAccept,
        allowed.length
          ? `Only items from ${allowed.map(({ name }) => name).join(', ')} can be added to an order being prepared`
          : 'The store does not take additions to an order being prepared'
      );
    }

    const writeLine = await prepareLine(db, scope.storeId, input);

    await db.transaction(async (tx) => {
      const order = await tx.orders.findOne({ select: { status: true }, where: { id: last.id }, lock: true });

      if (order?.status !== OrderStatus.Accepted) {
        throw new OrderError(OrderErrorCode.NoOrderInProgress, 'The order is no longer being prepared');
      }

      await writeLine(tx, last.id);
      await syncOrderStock(tx, { storeId: scope.storeId, orderId: last.id, enforce: true });
      await getCart(tx, last.id);

      const now = new Date().toISOString();

      await tx.orders.updateOne({ data: { amended_at: now, updated_at: now }, where: { id: last.id } });
    });

    return getCart(db, last.id);
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
    input: { address: string; neighborhood: string | null },
    geocode?: Geocode
  ) => {
    const origin = await distanceOrigin(db, scope.storeId);
    const current = origin && (await findCurrentOrder(db, scope));

    const pinned =
      !!current &&
      (await db.orders.findOne({ select: { location_pinned: true }, where: { id: current.id } }))?.location_pinned ===
        true;

    // Distance delivery without a pin: every typed address is geocoded again (never a guessed or stale fee).
    const geocoded = !!origin && !pinned;

    const location =
      geocoded && geocode
        ? await geocode([input.address, input.neighborhood].filter(Boolean).join(', '), origin)
        : undefined;

    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      await client.orders.updateOne({
        data: {
          fulfillment: Fulfillment.Delivery,
          address: input.address,
          neighborhood: input.neighborhood,
          ...(geocoded &&
            (location
              ? { ...locationData(origin, location), location_pinned: false }
              : { latitude: null, longitude: null, distance_meters: null, location_pinned: null }))
        },
        where: { id }
      });
    });

    if (geocoded && !location) {
      throw new OrderError(OrderErrorCode.LocationNeeded, 'Ask the customer to share the WhatsApp location');
    }

    return getCart(db, orderId);
  };

  /**
   * The customer's last delivery address at this store (any conversation), with the location it had.
   */
  export const findSavedAddress = async (db: DbClient, scope: DraftScope) => {
    const {
      records: [order]
    } = await db.orders.findMany({
      select: { address: true, neighborhood: true, latitude: true, longitude: true, location_pinned: true },
      where: {
        store_id: scope.storeId,
        customer_id: scope.customerId,
        fulfillment: Fulfillment.Delivery,
        placed_at: { isNull: false },
        address: { isNull: false }
      },
      order: { placed_at: Order.Desc },
      take: 1
    });

    return order?.address
      ? {
          address: order.address,
          neighborhood: order.neighborhood ?? null,
          location:
            order.latitude != null && order.longitude != null
              ? { latitude: order.latitude, longitude: order.longitude }
              : undefined,
          pinned: order.location_pinned === true
        }
      : undefined;
  };

  /**
   * "Mesmo endereço": the last delivery address and its location go to the current order, so distance delivery
   * needs no new geocoding. Without a stored location it is set like a typed address.
   */
  export const applySavedAddress = async (db: DbClient, scope: DraftScope, geocode?: Geocode) => {
    const saved = await findSavedAddress(db, scope);

    if (!saved) {
      throw new OrderError(OrderErrorCode.NoSavedAddress, 'The customer has no previous delivery address');
    }

    const input = { address: saved.address, neighborhood: saved.neighborhood };
    const origin = await distanceOrigin(db, scope.storeId);

    if (!origin || !saved.location) {
      return setAddress(db, scope, input, geocode);
    }

    const current = await findCurrentOrder(db, scope);

    // A pin sent in this order is newer than the saved location.
    const pinned =
      !!current &&
      (await db.orders.findOne({ select: { location_pinned: true }, where: { id: current.id } }))?.location_pinned ===
        true;

    const location = saved.location;

    const orderId = await writeCurrentOrder(db, scope, true, async (client, id) => {
      await client.orders.updateOne({
        data: {
          fulfillment: Fulfillment.Delivery,
          ...input,
          ...(!pinned && { ...locationData(origin, location), location_pinned: saved.pinned })
        },
        where: { id }
      });
    });

    return getCart(db, orderId);
  };

  /**
   * The customer's newest order at this store that ended in one of `statuses`, with its items.
   */
  export const findPreviousOrder = async (db: DbClient, scope: DraftScope, statuses: OrderStatus[]) => {
    if (!statuses.length) {
      return undefined;
    }

    const {
      records: [order]
    } = await db.orders.findMany({
      select: { id: true, status: true, placed_at: true, abandoned_at: true, total_cents: true },
      where: {
        store_id: scope.storeId,
        customer_id: scope.customerId,
        status: { isIn: statuses },
        subtotal_cents: { gt: 0 },
        // Counter sales are not the customer's WhatsApp history.
        OR: [{ source: { isNull: true } }, { source: { not: OrderSource.Pos } }]
      },
      order: { created_at: Order.Desc },
      take: 1
    });

    // Placed orders have `placed_at`; an abandoned draft has when the customer stopped.
    const at = order?.placed_at ?? order?.abandoned_at;

    if (!order || !at) {
      return undefined;
    }

    const { records: items } = await db.order_items.findMany({
      select: { product_id: true, product_name: true, qty: true, options_snapshot: true, notes: true },
      where: { order_id: order.id },
      order: { created_at: Order.Asc }
    });

    return {
      status: order.status,
      placedAt: at,
      totalCents: order.total_cents,
      items: items.map((item) => ({
        productId: item.product_id,
        name: item.product_name,
        qty: item.qty,
        options: describeOptions(item.options_snapshot),
        selections: item.options_snapshot.map(({ group_id, options }) => ({
          group_id,
          option_ids: options.map(({ id }) => id)
        })),
        notes: item.notes ?? null
      }))
    };
  };

  /**
   * A WhatsApp location pin: stored on the current order (created if needed) with its distance, when the store
   * delivers by distance; ignored otherwise. The pin implies delivery.
   */
  export const setLocation = async (db: DbClient, scope: DraftScope, location: Coordinates) => {
    const origin = await distanceOrigin(db, scope.storeId);

    if (!origin) {
      return;
    }

    // A pin sent while the store prepares the last order is for the courier, not a new order.
    if (!(await findCurrentOrder(db, scope))) {
      const last = await findLastPlaced(db, scope.conversationId);

      if (last && (last.status === OrderStatus.Accepted || last.status === OrderStatus.Out)) {
        return;
      }
    }

    try {
      await writeCurrentOrder(db, scope, true, async (client, id) => {
        await client.orders.updateOne({
          data: { fulfillment: Fulfillment.Delivery, ...locationData(origin, location), location_pinned: true },
          where: { id }
        });
      });
    } catch (error) {
      // The store took the order meanwhile: same as above.
      if (error instanceof OrderError && error.code === OrderErrorCode.OrderLocked) {
        return;
      }

      throw error;
    }
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
  export const place = async (db: DbClient, scope: DraftScope, options: { byStaff?: boolean } = {}) => {
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
      const placed = await db.orders.findOne({ select: { id: true, code: true }, where: { id: current.id } });

      return { ...cart, code: placed ? displayOrderCode(placed) : null, review: false };
    }

    // The store itself may take an order at any time; the review exists to protect it from the bot.
    const lastOrderMinutes = options.byStaff ? null : policy.last_order_minutes;

    if (store && lastOrderMinutes != null && isClosingSoon(hours, store.timezone, new Date(), lastOrderMinutes)) {
      throw new OrderError(
        OrderErrorCode.StoreClosing,
        `The store stops taking orders ${lastOrderMinutes} minutes before closing`
      );
    }

    // A new customer's large first order goes to a person before the kitchen trusts it.
    const reviewCents = policy.new_customer_review_cents;

    const review =
      !options.byStaff &&
      reviewCents != null &&
      cart.total_cents > reviewCents &&
      !(await db.orders.count({
        where: { customer_id: scope.customerId, status: { isIn: OPEN_ORDER_STATUSES } }
      }));

    // Stock, number and status in one commit: a shortage leaves the draft as it was and gives no number away.
    const placed = await db.transaction(async (tx) => {
      const order = await tx.orders.findOne({
        select: { status: true, code: true },
        where: { id: current.id },
        lock: true
      });

      // A parallel placement of the same draft won: answer as for a placed order.
      if (order?.status === OrderStatus.Placed) {
        return { code: displayOrderCode({ id: current.id, code: order.code }), first: false };
      }

      if (order?.status !== OrderStatus.Draft) {
        throw new OrderError(OrderErrorCode.NoDraft, 'There is no open order');
      }

      await syncOrderStock(tx, { storeId: scope.storeId, orderId: current.id, enforce: !options.byStaff });

      const now = new Date().toISOString();
      const code = await nextOrderCodeIn(tx, scope.storeId);

      await tx.orders.updateOne({
        data: { status: OrderStatus.Placed, code, placed_at: now, updated_at: now },
        where: { id: current.id }
      });

      // The next order checks the limits again.
      await tx.conversations.updateOne({
        data: { draft_order_id: null, approved_reason: null },
        where: { id: scope.conversationId }
      });

      if (cart.fulfillment === Fulfillment.Delivery && cart.address) {
        await tx.customers.updateOne({
          data: { last_address: cart.address, updated_at: now },
          where: { id: scope.customerId }
        });
      }

      return { code, first: true };
    });

    return { ...cart, status: OrderStatus.Placed, code: placed.code, review: placed.first && review };
  };

  /**
   * Store move from the panel. Locks the order like `editPlacedOrder`, so an agent edit and an accept never
   * interleave. Returns what the customer notification needs.
   */
  export const setStatus = async (db: DbClient, input: { storeId: string; orderId: string; status: OrderStatus }) => {
    return db.transaction(async (tx) => {
      const order = await tx.orders.findOne({
        select: {
          store_id: true,
          status: true,
          source: true,
          conversation_id: true,
          fulfillment: true,
          payment_method: true,
          total_cents: true
        },
        where: { id: input.orderId },
        lock: true
      });

      // A draft is still the customer's cart: the panel never sees it.
      if (!order || order.store_id !== input.storeId || order.status === OrderStatus.Draft) {
        throw new OrderStatusError(OrderStatusErrorCode.NotFound, 'Order not found');
      }

      // A POS sale is canceled from the POS (reason, refund).
      if (order.source === OrderSource.Pos && input.status === OrderStatus.Canceled) {
        throw new OrderError(OrderErrorCode.PosCancel, 'A counter sale is canceled from the POS');
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

      if (input.status === OrderStatus.Canceled) {
        await syncOrderStock(tx, { storeId: input.storeId, orderId: input.orderId, enforce: false, canceled: true });
      }

      // The driver or the pickup brings a WhatsApp/web order's cash to the drawer.
      if (
        input.status === OrderStatus.Done &&
        order.source !== OrderSource.Pos &&
        order.payment_method === PaymentMethod.Cash &&
        (await StoreRepository.getPosSettings(tx, input.storeId)).cashControl
      ) {
        await CashRepository.recordOrderCash(tx, input.storeId, {
          orderId: input.orderId,
          amountCents: order.total_cents,
          author: 'system'
        });
      }

      return { conversationId: order.conversation_id ?? null, fulfillment: order.fulfillment ?? null };
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
        where: { id: { isIn: [...new Set(orders.flatMap(({ customer_id }) => (customer_id ? [customer_id] : [])))] } }
      })
    ]);

    return orders.map((order) => {
      const customer = customers.find(({ id }) => id === order.customer_id);

      return {
        ...order,
        // POS sales may have no customer row, only a typed name.
        customer: { name: customer?.name ?? order.customer_name ?? null, phone: customer?.phone ?? null },
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
   * Open: the kitchen queue, oldest first. Closed: the latest finished or canceled orders, plus the latest abandoned
   * drafts that had items (stale drafts are marked first).
   */
  export const listForPanel = async (db: DbClient, storeId: string, scope: PanelOrderScope) => {
    if (scope === PanelOrderScope.Open) {
      return withDetails(db, await findPanelOrders(db, storeId, scope));
    }

    await abandonStaleDrafts(db, new Date(), storeId);

    const [closed, { records: abandoned }] = await Promise.all([
      findPanelOrders(db, storeId, scope),
      db.orders.findMany({
        select: PANEL_ORDER_FIELDS,
        where: { store_id: storeId, status: OrderStatus.Abandoned, subtotal_cents: { gt: 0 } },
        order: { abandoned_at: Order.Desc },
        take: PANEL_ABANDONED_LIMIT
      })
    ]);

    return withDetails(db, [...closed, ...abandoned]);
  };

  /**
   * The conversation's draft row (no cart recompute), for its progress in the panel.
   */
  export const findDraftRow = async (db: DbClient, conversationId: string) => {
    const draftId = await findDraftId(db, conversationId);

    return draftId
      ? db.orders.findOne({
          select: { subtotal_cents: true, fulfillment: true, address: true, payment_method: true },
          where: { id: draftId }
        })
      : undefined;
  };

  /**
   * A customer's placed orders in the store (any source), newest first, with what is needed to order them again.
   */
  export const listForCustomer = async (db: DbClient, storeId: string, customerIds: string[], limit: number) => {
    if (!customerIds.length) {
      return [];
    }

    const { records: orders } = await db.orders.findMany({
      select: { id: true, code: true, status: true, source: true, placed_at: true, total_cents: true },
      where: { store_id: storeId, customer_id: { isIn: customerIds }, placed_at: { isNull: false } },
      order: { placed_at: Order.Desc },
      take: limit
    });

    if (!orders.length) {
      return [];
    }

    const { records: items } = await db.order_items.findMany({
      select: { order_id: true, product_id: true, product_name: true, qty: true, options_snapshot: true, notes: true },
      where: { order_id: { isIn: orders.map(({ id }) => id) } },
      order: { created_at: Order.Asc }
    });

    return orders.map((order) => ({
      code: displayOrderCode(order),
      status: order.status,
      source: order.source ?? null,
      placedAt: order.placed_at!,
      totalCents: order.total_cents,
      items: items
        .filter(({ order_id }) => order_id === order.id)
        .map((item) => ({
          productId: item.product_id,
          name: item.product_name,
          qty: item.qty,
          options: describeOptions(item.options_snapshot),
          selections: item.options_snapshot.map(({ group_id, options }) => ({
            groupId: group_id,
            optionIds: options.map(({ id }) => id)
          })),
          notes: item.notes ?? null
        }))
    }));
  };

  /**
   * The conversation's orders as marks in its thread: placed ones (at `placed_at`) and abandoned drafts that had items
   * (at the customer's last message), oldest first.
   */
  export const marksForConversation = async (db: DbClient, conversationId: string) => {
    const select = {
      id: true,
      code: true,
      status: true,
      placed_at: true,
      abandoned_at: true,
      total_cents: true
    } as const;

    const [{ records: placed }, { records: abandoned }] = await Promise.all([
      db.orders.findMany({ select, where: { conversation_id: conversationId, placed_at: { isNull: false } } }),
      db.orders.findMany({
        select,
        where: { conversation_id: conversationId, status: OrderStatus.Abandoned, subtotal_cents: { gt: 0 } }
      })
    ]);

    return [...placed, ...abandoned]
      .map((order) => ({
        id: order.id,
        code: order.placed_at ? displayOrderCode(order) : null,
        status: order.status,
        at: (order.placed_at ?? order.abandoned_at)!,
        totalCents: order.total_cents
      }))
      .filter(({ at }) => !!at)
      .sort((a, b) => a.at.localeCompare(b.at));
  };

  /**
   * A new empty draft that becomes the conversation's draft only if it has none (checked in the same update): the
   * web order never writes into a draft someone else (the bot) started. Undefined when the conversation already had
   * one.
   */
  export const claimNewDraft = async (db: DbClient, scope: DraftScope) => {
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

    await db.conversations.updateMany({
      data: { draft_order_id: id },
      where: { id: scope.conversationId, draft_order_id: null }
    });

    if ((await findDraftId(db, scope.conversationId)) === id) {
      return id;
    }

    await db.orders.deleteMany({ where: { id } });

    return undefined;
  };

  /**
   * Deletes `orderId` and its items while it is still a draft (a web order that failed half-way), and unlinks it
   * from the conversation only if it is still the conversation's draft.
   */
  export const discardDraft = async (db: DbClient, input: { conversationId: string; orderId: string }) => {
    await db.conversations.updateMany({
      data: { draft_order_id: null },
      where: { id: input.conversationId, draft_order_id: input.orderId }
    });

    const order = await db.orders.findOne({ select: { status: true }, where: { id: input.orderId } });

    if (order?.status !== OrderStatus.Draft) {
      return;
    }

    await db.order_items.deleteMany({ where: { order_id: input.orderId } });
    await db.orders.deleteMany({ where: { id: input.orderId, status: OrderStatus.Draft } });
  };

  /**
   * Marks the draft abandoned: it leaves the conversation (the bot starts a new order) and keeps the time the customer
   * stopped. Billing is untouched: a draft nobody handed off was never billed.
   */
  const abandonDraft = async (db: DbClient, draft: { id: string; conversation_id: string }, at: string) => {
    await db.orders.updateOne({
      data: { status: OrderStatus.Abandoned, abandoned_at: at, updated_at: new Date().toISOString() },
      where: { id: draft.id, status: OrderStatus.Draft }
    });

    await db.conversations.updateOne({
      data: { draft_order_id: null },
      where: { id: draft.conversation_id, draft_order_id: draft.id }
    });
  };

  /**
   * The conversation's draft when the customer's previous activity (`lastActivity`, before the messages being answered
   * now) is older than the order memory window: called by the turn before it reads the draft.
   */
  export const abandonIfStale = async (
    db: DbClient,
    input: { conversationId: string; lastActivity: string | undefined; memorySince: string }
  ) => {
    if (!input.lastActivity || Date.parse(input.lastActivity) >= Date.parse(input.memorySince)) {
      return false;
    }

    const draftId = await findDraftId(db, input.conversationId);

    if (!draftId) {
      return false;
    }

    await abandonDraft(db, { id: draftId, conversation_id: input.conversationId }, input.lastActivity);

    return true;
  };

  /**
   * Every draft (of one store, or all) whose conversation got no message inside its store's memory window: the daily
   * cron and the panel lists run it, so drafts of customers who never came back are marked too.
   */
  export const abandonStaleDrafts = async (db: DbClient, now: Date, storeId?: string) => {
    const { records } = await db.orders.findMany({
      select: { id: true, store_id: true, conversation_id: true },
      // POS held sales have no conversation and never expire.
      where: { status: OrderStatus.Draft, conversation_id: { isNull: false }, ...(storeId && { store_id: storeId }) }
    });

    const drafts = records.flatMap(({ conversation_id, ...draft }) =>
      conversation_id ? [{ ...draft, conversation_id }] : []
    );

    if (!drafts.length) {
      return 0;
    }

    const [{ records: conversations }, { records: stores }] = await Promise.all([
      db.conversations.findMany({
        select: { id: true, last_message_at: true },
        where: { id: { isIn: [...new Set(drafts.map(({ conversation_id }) => conversation_id))] } }
      }),
      db.stores.findMany({
        select: { id: true, policy: true },
        where: { id: { isIn: [...new Set(drafts.map(({ store_id }) => store_id))] } }
      })
    ]);

    let abandoned = 0;

    for (const draft of drafts) {
      const lastMessageAt = conversations.find(({ id }) => id === draft.conversation_id)?.last_message_at;
      const policy = stores.find(({ id }) => id === draft.store_id)?.policy;

      if (lastMessageAt && Date.parse(lastMessageAt) < Date.parse(orderMemorySince(policy, now))) {
        await abandonDraft(db, draft, lastMessageAt);
        abandoned++;
      }
    }

    return abandoned;
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
