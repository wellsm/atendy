import type { DbClient } from '../db';
import type { Selection } from '../orders/pricing';
import type { Geocode } from '../orders/repository';
import type { Coordinates } from '../stores/geo';
import type { PaymentMethod } from '../stores/types';

import { randomUUID } from 'node:crypto';

import { BillingRepository } from '../billing/repository';
import { ConversationMode, MessageAuthor, MessageDirection } from '../conversations/types';
import { MenuRepository } from '../menu/repository';
import { priceItem } from '../orders/pricing';
import { OrderError, OrderErrorCode, OrderRepository } from '../orders/repository';
import { Fulfillment, OrderSource, OrderStatus } from '../orders/types';
import { resolveDeliveryFee } from '../stores/delivery';
import { distanceMeters, pickBandFee } from '../stores/geo';
import { isStoreOpen } from '../stores/hours';
import { StoreRepository } from '../stores/repository';
import { DeliveryMode } from '../stores/types';

/**
 * Open web orders one phone may have waiting for the store.
 */
const MAX_OPEN_PER_PHONE = 2;

/**
 * Web orders a store takes per minute: above it, the form waits (bursts are abuse, not customers).
 */
const MAX_PER_STORE_MINUTE = 10;

export const enum WebOrderErrorCode {
  StoreClosed = 'store_closed',
  Phone = 'phone',
  OrderInProgress = 'order_in_progress',
  TooMany = 'too_many',
  /**
   * Phone codes: wait the resend countdown, too many codes for the phone or IP, wrong/expired code, too many tries,
   * WhatsApp did not send, order without a verified phone.
   */
  ResendWait = 'resend_wait',
  TooManyCodes = 'too_many_codes',
  CodeInvalid = 'code_invalid',
  CodeExpired = 'code_expired',
  TooManyAttempts = 'too_many_attempts',
  CodeSendFailed = 'code_send_failed',
  PhoneUnverified = 'phone_unverified'
}

export class WebOrderError extends Error {
  constructor(
    public readonly code: WebOrderErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type WebOrderItem = { productId: string; qty: number; selections: Selection[]; notes?: string | null };

export type WebOrderDelivery = {
  fulfillment: Fulfillment;
  /**
   * Street, number and complement.
   */
  address?: string | null;
  neighborhood?: string | null;
  /**
   * Browser GPS (distance delivery).
   */
  location?: Coordinates | null;
};

/**
 * A Brazilian phone typed in the form as E.164 without `+` (`55` + DDD + number), or undefined when it is not one.
 */
export const normalizePhone = (typed: string) => {
  const digits = typed.replace(/\D/g, '');
  const national = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;

  return national.length === 10 || national.length === 11 ? `55${national}` : undefined;
};

/**
 * The phone plus its old 8-digit mobile form (WhatsApp keeps some accounts without the 9).
 */
export const phoneVariants = (phone: string) =>
  phone.length === 13 && phone[4] === '9' ? [phone, `${phone.slice(0, 4)}${phone.slice(5)}`] : [phone];

const addressText = (delivery: WebOrderDelivery) =>
  [delivery.address, delivery.neighborhood].filter(Boolean).join(', ');

/**
 * The public store if it takes orders now (active, not blocked, accepting and open).
 */
export const requireOrderingStore = async (db: DbClient, slug: string) => {
  const store = await StoreRepository.findBySlug(db, slug);

  const blocked =
    !!store &&
    (await db.stores.findOne({ select: { billing_blocked: true }, where: { id: store.id } }))?.billing_blocked;

  if (!store?.active || blocked) {
    return undefined;
  }

  const hours = await StoreRepository.getHours(db, store.id);

  if (!store.accepting_orders || !isStoreOpen(hours, store.timezone, new Date())) {
    throw new WebOrderError(WebOrderErrorCode.StoreClosed, 'The store is not taking orders now');
  }

  return store;
};

/**
 * Prices and delivery fee for the checkout, without writing anything. `feeCents` is null when the delivery cannot be
 * priced yet (`deliveryError`). Distance delivery uses the GPS, else geocodes the typed address.
 */
export const quoteWebOrder = async (
  db: DbClient,
  storeId: string,
  input: { items: WebOrderItem[]; delivery: WebOrderDelivery },
  geocode: Geocode
) => {
  const [menu, settings] = await Promise.all([
    MenuRepository.load(db, storeId),
    StoreRepository.getSettings(db, storeId)
  ]);

  const subtotalCents = input.items.reduce((total, item) => {
    const product = menu.find(({ id }) => id === item.productId);

    if (!product) {
      throw new OrderError(OrderErrorCode.UnknownProduct, `Unknown product ${item.productId}`);
    }

    return total + priceItem(product, item.selections).unit_price_cents * item.qty;
  }, 0);

  const delivery = settings!.delivery;
  const { fulfillment } = input.delivery;
  let feeCents: number | undefined;
  let distanceKm: number | null = null;
  let deliveryError: 'location_needed' | 'out_of_area' | null = null;

  if (fulfillment === Fulfillment.Pickup || delivery.mode !== DeliveryMode.ByDistance) {
    feeCents = resolveDeliveryFee({
      fulfillment,
      deliveryMode: delivery.mode,
      flatFeeCents: delivery.flatFeeCents,
      zones: delivery.zones.map(({ neighborhood, feeCents: fee }) => ({ neighborhood, fee_cents: fee })),
      neighborhood: input.delivery.neighborhood
    });

    deliveryError = feeCents === undefined ? 'out_of_area' : null;
  } else {
    const origin = await StoreRepository.getStoreLocation(db, storeId);
    const typed = addressText(input.delivery);

    const location =
      input.delivery.location ?? (origin && typed && input.delivery.address ? await geocode(typed, origin) : undefined);

    if (!origin || !location) {
      deliveryError = 'location_needed';
    } else {
      const meters = distanceMeters(origin, location);

      distanceKm = Math.round(meters / 100) / 10;
      feeCents = pickBandFee(delivery.bands ?? [], meters);
      deliveryError = feeCents === undefined ? 'out_of_area' : null;
    }
  }

  const minOrderCents = settings!.policy.min_order_cents ?? null;

  return {
    subtotalCents,
    feeCents: feeCents ?? null,
    totalCents: feeCents === undefined ? null : subtotalCents + feeCents,
    distanceKm,
    deliveryError,
    minOrderCents,
    belowMinimum: minOrderCents != null && subtotalCents < minOrderCents
  };
};

/**
 * The store's customer with this phone (also its old 8-digit form), created when new; a known customer without a name
 * gets `name`. Returns its id.
 */
export const findOrCreateCustomer = async (db: DbClient, storeId: string, phone: string, name?: string | null) => {
  const now = new Date().toISOString();

  const {
    records: [existing]
  } = await db.customers.findMany({
    select: { id: true, name: true },
    where: { store_id: storeId, phone: { isIn: phoneVariants(phone) } },
    take: 1
  });

  const customerId = existing?.id ?? randomUUID();

  if (!existing) {
    await db.customers.insertOne({
      data: {
        id: customerId,
        store_id: storeId,
        phone,
        whatsapp_jid: `${phone}@s.whatsapp.net`,
        name: name ?? null,
        created_at: now,
        updated_at: now
      }
    });
  } else if (!existing.name && name) {
    await db.customers.updateOne({ data: { name, updated_at: now }, where: { id: customerId } });
  }

  return customerId;
};

/**
 * The customer (by phone, also its old 8-digit form) and its conversation; created when new.
 */
export const customerConversation = async (db: DbClient, storeId: string, phone: string, name: string) => {
  const now = new Date().toISOString();
  const customerId = await findOrCreateCustomer(db, storeId, phone, name);

  const { record: conversation } = await db.conversations.upsertOne({
    select: { id: true },
    insert: {
      id: randomUUID(),
      store_id: storeId,
      customer_id: customerId,
      mode: ConversationMode.Bot,
      last_message_at: now,
      created_at: now
    },
    update: {},
    where: { store_id: storeId, customer_id: customerId }
  });

  return { storeId, conversationId: conversation.id, customerId };
};

/**
 * Builds and places the customer's order like the attendant does (no `max_*` limits), marks it `web`, bills the web
 * percent and leaves a processed message in the conversation (the bot never answers it). The store accepts it in the
 * panel; WhatsApp is told only from then on.
 */
export const placeWebOrder = async (
  db: DbClient,
  storeId: string,
  input: {
    name: string;
    phone: string;
    items: WebOrderItem[];
    delivery: WebOrderDelivery;
    payment: { method: PaymentMethod; changeForCents?: number | null };
  },
  geocode: Geocode
) => {
  const phone = normalizePhone(input.phone);

  if (!phone) {
    throw new WebOrderError(WebOrderErrorCode.Phone, 'Invalid phone');
  }

  if (input.delivery.fulfillment === Fulfillment.Delivery && !input.delivery.address?.trim()) {
    throw new OrderError(OrderErrorCode.Incomplete, 'Order is missing: address');
  }

  const scope = await customerConversation(db, storeId, phone, input.name);

  if (await OrderRepository.findCurrentOrder(db, scope)) {
    throw new WebOrderError(WebOrderErrorCode.OrderInProgress, 'The customer has an order in progress');
  }

  const [openByPhone, lastMinute] = await Promise.all([
    db.orders.count({
      where: { customer_id: scope.customerId, source: OrderSource.Web, status: OrderStatus.Placed }
    }),
    db.orders.count({
      where: {
        store_id: storeId,
        source: OrderSource.Web,
        placed_at: { gte: new Date(Date.now() - 60_000).toISOString() }
      }
    })
  ]);

  if (openByPhone >= MAX_OPEN_PER_PHONE || lastMinute >= MAX_PER_STORE_MINUTE) {
    throw new WebOrderError(WebOrderErrorCode.TooMany, 'Too many web orders');
  }

  // Our own draft, claimed only if the conversation has none: nothing is ever added to (or deleted from) another one.
  const draftId = await OrderRepository.claimNewDraft(db, scope);

  if (!draftId) {
    throw new WebOrderError(WebOrderErrorCode.OrderInProgress, 'The customer has an order in progress');
  }

  const menu = await MenuRepository.load(db, storeId);
  let cart;

  try {
    for (const item of input.items) {
      const product = menu.find(({ id }) => id === item.productId);

      if (!product) {
        throw new OrderError(OrderErrorCode.UnknownProduct, `Unknown product ${item.productId}`);
      }

      await OrderRepository.addItem(db, scope, {
        product,
        qty: item.qty,
        selections: item.selections,
        notes: item.notes?.trim() || null,
        skipLimits: true
      });
    }

    await OrderRepository.setFulfillment(db, scope, input.delivery.fulfillment);

    if (input.delivery.fulfillment === Fulfillment.Delivery) {
      if (input.delivery.location) {
        await OrderRepository.setLocation(db, scope, input.delivery.location);
      }

      await OrderRepository.setAddress(
        db,
        scope,
        { address: input.delivery.address?.trim() ?? '', neighborhood: input.delivery.neighborhood?.trim() || null },
        geocode
      );
    }

    await OrderRepository.setPayment(db, scope, {
      method: input.payment.method,
      changeForCents: input.payment.changeForCents ?? null
    });

    cart = await OrderRepository.place(db, scope);
  } catch (error) {
    // Never leave the half-built web cart as the conversation's draft: the bot would continue it on WhatsApp.
    await OrderRepository.discardDraft(db, { conversationId: scope.conversationId, orderId: draftId });

    throw error;
  }

  const now = new Date().toISOString();
  const code = cart.code ?? cart.order_id.slice(0, 4).toUpperCase();

  await db.orders.updateOne({ data: { source: OrderSource.Web }, where: { id: cart.order_id } });
  await BillingRepository.recordWebOrder(db, { storeId, conversationId: scope.conversationId, orderId: cart.order_id });

  await db.messages.insertOne({
    data: {
      id: randomUUID(),
      store_id: storeId,
      conversation_id: scope.conversationId,
      direction: MessageDirection.In,
      author: MessageAuthor.Customer,
      body: `🛒 Pedido pelo site #${code}`,
      provider_message_id: `web:${cart.order_id}`,
      processed_at: now,
      created_at: now
    }
  });

  await db.conversations.updateOne({ data: { last_message_at: now }, where: { id: scope.conversationId } });

  return { code, totalCents: cart.total_cents, orderId: cart.order_id, phone };
};
