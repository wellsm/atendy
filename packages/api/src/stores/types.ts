import type { OrderStatus } from '../orders/types';

export const enum RouterType {
  Jev = 'jev',
  Llm = 'llm'
}

export const enum WhatsAppProviderType {
  Evolution = 'evolution',
  CloudApi = 'cloud_api'
}

export const enum DeliveryMode {
  Flat = 'flat',
  ByZone = 'by_zone',
  ByDistance = 'by_distance'
}

export const enum PaymentMethod {
  Pix = 'pix',
  Cash = 'cash',
  Credit = 'credit',
  Debit = 'debit',
  /**
   * Vale-refeição (VR).
   */
  MealVoucher = 'meal_voucher',
  /**
   * Vale-alimentação (VA).
   */
  FoodVoucher = 'food_voucher',
  /**
   * Legacy (before credit/debit): old orders, payments and store lists only; never offered or accepted again.
   */
  Card = 'card',
  /**
   * Legacy (before VR/VA): old orders, payments and store lists only; never offered or accepted again.
   */
  Voucher = 'voucher'
}

/**
 * Brands a store accepts per brand method; a missing key (or null) = every brand of `PAYMENT_BRANDS`.
 */
export type PaymentBrands = {
  credit?: string[] | null;
  debit?: string[] | null;
  meal_voucher?: string[] | null;
  food_voucher?: string[] | null;
};

/**
 * Store guardrails. Missing or `null` means no limit (`order_memory_hours`: the default). Numbers are enforced in
 * code; `sop` is guidance for the model.
 */
/**
 * How the bot offers the customer's last delivery address.
 */
export const enum PreviousAddress {
  /**
   * As soon as the order is for delivery: "Entrego na Rua X, 123 de novo?"
   */
  Ask = 'ask',
  /**
   * Only when the customer refers to it: "mesmo endereço da última vez".
   */
  OnRequest = 'on_request'
}

export type StorePolicy = {
  /**
   * Rollout mode: new conversations start with a person (`BOT_OPT_IN_REASON`) and the bot answers only the ones the
   * store passes to it in the panel.
   */
  bot_opt_in?: boolean | null;
  /**
   * Per cart line.
   */
  max_item_qty?: number | null;
  /**
   * Order subtotal.
   */
  max_order_cents?: number | null;
  /**
   * Change = change_for - total.
   */
  max_change_cents?: number | null;
  /**
   * Order subtotal.
   */
  min_order_cents?: number | null;
  /**
   * First order of a customer above this total is placed and handed to a human.
   */
  new_customer_review_cents?: number | null;
  /**
   * Stop placing orders this many minutes before closing.
   */
  last_order_minutes?: number | null;
  /**
   * Window for the previous order and for history.
   */
  order_memory_hours?: number | null;
  /**
   * Usual delivery time range the bot tells the customer when asked.
   */
  delivery_min_minutes?: number | null;
  delivery_max_minutes?: number | null;
  sop?: string | null;
  /**
   * Null = `ask`.
   */
  previous_address?: PreviousAddress | null;
  /**
   * The bot offers to repeat the customer's previous order when it ended in one of these statuses; empty or null =
   * never.
   */
  repeat_order_statuses?: OrderStatus[] | null;
  /**
   * A new order may start once the conversation's last placed order reached this status (`done`/`canceled` always
   * allow it). Null = `done` (one order at a time). A `placed` order is always edited instead.
   */
  new_order_after_status?: NewOrderAfterStatus | null;
  /**
   * Categories the customer may add to an order the store is preparing (`accepted`). Null = drink categories
   * (`isDrinkCategory`); empty = none.
   */
  add_on_category_ids?: string[] | null;
  /**
   * Delay the bot quotes for such an addition. Null = no number.
   */
  add_on_extra_minutes?: number | null;
  /**
   * Admin only. Replaces the catalog-link message of the greeting a new customer gets for a plain hello.
   */
  welcome_text?: string | null;
  /**
   * Admin only. A service the store handles in another system (e.g. bookings): the bot sends `url` when the customer
   * wants it, and that reply bills the cycle at `REDIRECT_PERCENT`.
   */
  redirect?: StoreRedirect | null;
  /**
   * Admin only. The store never sells: a fixed welcome with `redirect.url` on each new visit, then the redirect prompt
   * (catalog questions, handoff). Needs `redirect`.
   */
  redirect_only?: boolean | null;
};

export type StoreRedirect = {
  label: string;
  url: string;
};

/**
 * Order statuses after which a store lets the customer start another order (values of `OrderStatus`).
 */
export type PosSettings = {
  layout: 'grid' | 'search';
  cashControl: boolean;
  blindClose: boolean;
  receiptWidth: 58 | 80;
};

export type CourierFeeMode = 'order_fee' | 'fixed';

export type StaffSettings = {
  idleMinutes: number;
  discountLimitPercent: number;
  courierFeeMode: CourierFeeMode;
  courierFeeCents: number;
};

export const enum NewOrderAfterStatus {
  Accepted = 'accepted',
  Out = 'out',
  Done = 'done'
}

/**
 * How a store numbers its orders: 6 random symbols (default) or 1, 2, 3…
 */
export const enum OrderCodeMode {
  Random = 'random',
  Sequential = 'sequential'
}

/**
 * How the bot and the public page talk: a restaurant menu (default) or a product catalog. Null on a store = food.
 */
export const enum StoreType {
  Food = 'food',
  Retail = 'retail'
}
