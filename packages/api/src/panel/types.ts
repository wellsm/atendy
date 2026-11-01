import type { String } from '@ez4/schema';
import type { ConversationMode, MessageAuthor } from '../conversations/types';
import type { PriceMode } from '../menu/types';
import type { Cart, OrderRepository } from '../orders/repository';
import type { Fulfillment, OrderSource, OrderStatus } from '../orders/types';
import type { HourRange } from '../stores/hours';
import type { DeliveryMode, NewOrderAfterStatus, PaymentMethod, PreviousAddress, StorePolicy } from '../stores/types';

import { displayOrderCode } from '../orders/code';

export type PanelIdentity = {
  userId: string;
  /**
   * Active Clerk Organization (one org = one store). Absent during onboarding.
   */
  orgId?: string;
  /**
   * Minutes since the first factor was last verified (Clerk `fva[0]`); absent when Clerk did not say.
   */
  factorAgeMinutes?: number;
};

export type PanelStore = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  acceptingOrders: boolean;
  /**
   * The hours say open right now (store timezone). Independent of `acceptingOrders`.
   */
  openNow: boolean;
};

export const toPanelStore = (
  store: {
    id: string;
    name: string;
    slug: string;
    active: boolean;
    accepting_orders: boolean;
  },
  openNow: boolean
): PanelStore => ({
  id: store.id,
  name: store.name,
  slug: store.slug,
  active: store.active,
  acceptingOrders: store.accepting_orders,
  openNow
});

export type PanelHourRange = {
  /**
   * 0 = Sunday … 6 = Saturday.
   */
  weekday: number;
  opensAt: string;
  /**
   * `closesAt <= opensAt` ends the next day; equal means 24 h.
   */
  closesAt: string;
};

export type PanelDeliveryZone = {
  neighborhood: string;
  feeCents: number;
};

export type PanelDeliveryBand = {
  maxMeters: number;
  feeCents: number;
};

export type PanelDelivery = {
  mode: DeliveryMode;
  flatFeeCents: number;
  zones: PanelDeliveryZone[];
  /**
   * `by_distance` only; the API always answers with the list (empty for the other modes).
   */
  bands?: PanelDeliveryBand[];
};

/**
 * Store address as Google formatted it and its coordinates.
 */
export type PanelStoreLocation = {
  address: string;
  latitude: number;
  longitude: number;
};

/**
 * Editable policy keys; `null` = no limit.
 */
export type PanelPolicy = {
  minOrderCents: number | null;
  maxOrderCents: number | null;
  maxChangeCents: number | null;
  maxItemQty: number | null;
  newCustomerReviewCents: number | null;
  lastOrderMinutes: number | null;
  deliveryMinMinutes: number | null;
  deliveryMaxMinutes: number | null;
  sop: string | null;
  previousAddress: PreviousAddress | null;
  repeatOrderStatuses: OrderStatus[] | null;
  newOrderAfterStatus: NewOrderAfterStatus | null;
  addOnCategoryIds: string[] | null;
  addOnExtraMinutes: number | null;
};

export const toPanelHours = (hours: HourRange[]): PanelHourRange[] =>
  hours.map(({ weekday, opens_at, closes_at }) => ({ weekday, opensAt: opens_at, closesAt: closes_at }));

export const fromPanelHours = (hours: PanelHourRange[]): HourRange[] =>
  hours.map(({ weekday, opensAt, closesAt }) => ({ weekday, opens_at: opensAt, closes_at: closesAt }));

export const toPanelPolicy = (policy: StorePolicy): PanelPolicy => ({
  minOrderCents: policy.min_order_cents ?? null,
  maxOrderCents: policy.max_order_cents ?? null,
  maxChangeCents: policy.max_change_cents ?? null,
  maxItemQty: policy.max_item_qty ?? null,
  newCustomerReviewCents: policy.new_customer_review_cents ?? null,
  lastOrderMinutes: policy.last_order_minutes ?? null,
  deliveryMinMinutes: policy.delivery_min_minutes ?? null,
  deliveryMaxMinutes: policy.delivery_max_minutes ?? null,
  sop: policy.sop ?? null,
  previousAddress: policy.previous_address ?? null,
  repeatOrderStatuses: policy.repeat_order_statuses ?? null,
  newOrderAfterStatus: policy.new_order_after_status ?? null,
  addOnCategoryIds: policy.add_on_category_ids ?? null,
  addOnExtraMinutes: policy.add_on_extra_minutes ?? null
});

/**
 * Both null on a POS sale without a customer (name: the typed one, if any).
 */
export type PanelCustomer = {
  name: string | null;
  phone: string | null;
};

export type PanelOrderItem = {
  id: string;
  name: string;
  qty: number;
  options: string;
  notes: string | null;
  unitPriceCents: number;
};

export type PanelOrder = {
  id: string;
  /**
   * `K7Q2MX` / `128` (no `#`).
   */
  code: string;
  status: OrderStatus;
  fulfillment: Fulfillment | null;
  address: string | null;
  neighborhood: string | null;
  paymentMethod: PaymentMethod | null;
  changeForCents: number | null;
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  placedAt: string | null;
  abandonedAt: string | null;
  /**
   * `web` when the customer ordered on the public menu, `pos` for a counter sale; null for WhatsApp.
   */
  source: OrderSource | null;
  /**
   * Set when the customer changed the order after placing it ("pedido alterado").
   */
  amendedAt: string | null;
  /**
   * Null on POS sales.
   */
  conversationId: string | null;
  /**
   * Employee id or Clerk user id of who made / canceled it (counter sales and attendant orders); null otherwise.
   */
  createdBy: string | null;
  canceledBy: string | null;
  /**
   * Delivery orders that left with a courier.
   */
  courier: { id: string; name: string } | null;
  customer: PanelCustomer;
  items: PanelOrderItem[];
};

export const toPanelOrder = (order: OrderRepository.PanelOrder): PanelOrder => ({
  id: order.id,
  code: displayOrderCode(order),
  status: order.status,
  fulfillment: order.fulfillment ?? null,
  address: order.address ?? null,
  neighborhood: order.neighborhood ?? null,
  paymentMethod: order.payment_method ?? null,
  changeForCents: order.change_for_cents ?? null,
  subtotalCents: order.subtotal_cents,
  feeCents: order.fee_cents,
  totalCents: order.total_cents,
  placedAt: order.placed_at ?? null,
  abandonedAt: order.abandoned_at ?? null,
  source: order.source ?? null,
  amendedAt: order.amended_at ?? null,
  conversationId: order.conversation_id ?? null,
  createdBy: order.created_by ?? null,
  canceledBy: order.canceled_by ?? null,
  courier: order.courier,
  customer: order.customer,
  items: order.items.map((item) => ({
    id: item.id,
    name: item.product_name,
    qty: item.qty,
    options: item.options,
    notes: item.notes,
    unitPriceCents: item.unit_price_cents
  }))
});

export type PanelCartItem = {
  itemId: string;
  name: string;
  qty: number;
  options: string;
  unitPriceCents: number;
  lineTotalCents: number;
  notes: string | null;
};

/**
 * The conversation's draft as the attendant builds it; `missing` lists what placing still needs.
 */
export type PanelCart = {
  orderId: string;
  items: PanelCartItem[];
  fulfillment: Fulfillment | null;
  address: string | null;
  neighborhood: string | null;
  paymentMethod: PaymentMethod | null;
  changeForCents: number | null;
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  distanceKm: number | null;
  missing: string[];
};

export const toPanelCart = (cart: Cart): PanelCart => ({
  orderId: cart.order_id,
  items: cart.items.map((item) => ({
    itemId: item.item_id,
    name: item.name,
    qty: item.qty,
    options: item.options,
    unitPriceCents: item.unit_price_cents,
    lineTotalCents: item.line_total_cents,
    notes: item.notes
  })),
  fulfillment: cart.fulfillment,
  address: cart.address,
  neighborhood: cart.neighborhood,
  paymentMethod: cart.payment_method,
  changeForCents: cart.change_for_cents,
  subtotalCents: cart.subtotal_cents,
  feeCents: cart.fee_cents,
  totalCents: cart.total_cents,
  distanceKm: cart.distance_km ?? null,
  missing: cart.missing
});

export type PanelLastMessage = {
  author: MessageAuthor;
  body: string;
};

export type PanelConversation = {
  id: string;
  mode: ConversationMode;
  handoffReason: string | null;
  /**
   * The bot waits for the store to approve this (a limit or a suspected prank); null when it does not.
   */
  approvalReason: string | null;
  lastMessageAt: string;
  customer: PanelCustomer;
  lastMessage?: PanelLastMessage | null;
};

export const toPanelConversation = (conversation: {
  id: string;
  mode: ConversationMode;
  handoff_reason?: string | null;
  approval_reason?: string | null;
  last_message_at: string;
  customer: PanelCustomer;
  last_message?: PanelLastMessage | null;
}): PanelConversation => ({
  id: conversation.id,
  mode: conversation.mode,
  handoffReason: conversation.handoff_reason ?? null,
  approvalReason: conversation.approval_reason ?? null,
  lastMessageAt: conversation.last_message_at,
  customer: { name: conversation.customer.name, phone: conversation.customer.phone },
  ...(conversation.last_message !== undefined && { lastMessage: conversation.last_message })
});

export type PanelMessage = {
  id: string;
  author: MessageAuthor;
  body: string;
  createdAt: string;
  /**
   * The customer's reaction to this message (emoji).
   */
  reaction: string | null;
  /**
   * Signed URL (1 h) of the saved voice note.
   */
  audioUrl: string | null;
};

export type PanelOptionInput = {
  /**
   * Absent for a new option; an existing one keeps its id.
   */
  id?: String.UUID;
  name: string;
  priceDeltaCents: number;
  /**
   * Sent only when the store changed it in the form; absent keeps the stored value (new options start active).
   */
  active?: boolean;
};

export type PanelGroupInput = {
  /**
   * Absent for a new group; any group of the store keeps its id (a group of another product becomes shared).
   */
  id?: String.UUID;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: PanelOptionInput[];
};

/**
 * A group's shared part, edited from the groups library.
 */
export type PanelGroupContentInput = Omit<PanelGroupInput, 'id' | 'min' | 'max'>;

/**
 * A product saved whole, with its groups and options in display order.
 */
export type PanelProductInput = {
  categoryId: String.UUID;
  name: string;
  description: string | null;
  priceCents: number;
  /**
   * Same rule as the options: absent keeps the stored value.
   */
  active?: boolean;
  needsPreparation?: boolean | null;
  groups: PanelGroupInput[];
};

export type PanelOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
  /**
   * Signed read URL (1 h); null without a photo.
   */
  imageUrl: string | null;
};

export type PanelGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: PanelOption[];
};

export type PanelProduct = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  active: boolean;
  needsPreparation: boolean | null;
  /**
   * Signed read URL (1 h); null without a photo.
   */
  imageUrl: string | null;
  groups: PanelGroup[];
};

export type PanelCategory = {
  id: string;
  name: string;
};

export type PanelMenuCategory = PanelCategory & {
  needsPreparation: boolean;
  products: PanelProduct[];
};
