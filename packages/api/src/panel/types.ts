import type { String } from '@ez4/schema';
import type { ConversationMode, MessageAuthor } from '../conversations/types';
import type { PriceMode } from '../menu/types';
import type { OrderRepository } from '../orders/repository';
import type { Fulfillment, OrderStatus } from '../orders/types';
import type { HourRange } from '../stores/hours';
import type { DeliveryMode, PaymentMethod, StorePolicy } from '../stores/types';

export type PanelIdentity = {
  userId: string;
  /**
   * Active Clerk Organization (one org = one store). Absent during onboarding.
   */
  orgId?: string;
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

export type PanelDelivery = {
  mode: DeliveryMode;
  flatFeeCents: number;
  zones: PanelDeliveryZone[];
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
  sop: string | null;
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
  sop: policy.sop ?? null
});

export type PanelCustomer = {
  name: string | null;
  phone: string;
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
  /**
   * Set when the customer changed the order after placing it ("pedido alterado").
   */
  amendedAt: string | null;
  conversationId: string;
  customer: PanelCustomer;
  items: PanelOrderItem[];
};

export const toPanelOrder = (order: OrderRepository.PanelOrder): PanelOrder => ({
  id: order.id,
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
  amendedAt: order.amended_at ?? null,
  conversationId: order.conversation_id,
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

export type PanelConversation = {
  id: string;
  mode: ConversationMode;
  handoffReason: string | null;
  lastMessageAt: string;
  customer: PanelCustomer;
};

export const toPanelConversation = (conversation: {
  id: string;
  mode: ConversationMode;
  handoff_reason?: string | null;
  last_message_at: string;
  customer: PanelCustomer;
}): PanelConversation => ({
  id: conversation.id,
  mode: conversation.mode,
  handoffReason: conversation.handoff_reason ?? null,
  lastMessageAt: conversation.last_message_at,
  customer: { name: conversation.customer.name, phone: conversation.customer.phone }
});

export type PanelMessage = {
  id: string;
  author: MessageAuthor;
  body: string;
  createdAt: string;
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
   * Absent for a new group; an existing one keeps its id.
   */
  id?: String.UUID;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: PanelOptionInput[];
};

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
  groups: PanelGroupInput[];
};

export type PanelOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
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
  groups: PanelGroup[];
};

export type PanelCategory = {
  id: string;
  name: string;
};

export type PanelMenuCategory = PanelCategory & {
  products: PanelProduct[];
};
