import type { Database } from '@ez4/database';
import type { Enum, Integer, String } from '@ez4/schema';
import type {
  DeliveryMode,
  OrderCodeMode,
  PaymentBrands,
  PaymentMethod,
  RouterType,
  StorePolicy,
  StoreType,
  WhatsAppProviderType
} from '../types';

export interface StoreSchema extends Database.Schema {
  id: String.UUID;
  name: string;
  slug: string;
  timezone: string;
  clerk_org_id?: string | null;
  /**
   * Set by the admin. An inactive store gets no WhatsApp processing (no AI cost).
   */
  active: boolean;
  /**
   * When the owner accepted the unofficial-WhatsApp risk notice during onboarding.
   */
  risk_accepted_at?: String.DateTime | null;
  /**
   * Legacy pause; see `storeOpenState`.
   */
  accepting_orders: boolean;
  /**
   * Manual Aberto/Fechado over the hours; null = automatic.
   */
  open_override?: boolean | null;
  open_override_until?: String.DateTime | null;
  router: RouterType;
  llm_model: string;
  whatsapp_provider: WhatsAppProviderType;
  whatsapp_instance?: string | null;
  /**
   * Per-instance Evolution token used to send messages (never the global API key).
   */
  whatsapp_instance_token?: string | null;
  whatsapp_webhook_secret: string;
  delivery_mode: DeliveryMode;
  flat_fee_cents: Integer.Min<0>;
  /**
   * Store address as Google formatted it, and its coordinates: origin of distance delivery.
   */
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  payment_methods: PaymentMethod[];
  /**
   * Accepted brands per card/voucher method; null or a missing key = every brand (`stores/payment.ts`).
   */
  payment_brands?: PaymentBrands | null;
  policy?: StorePolicy | null;
  /**
   * Price of an order the AI took all the way (100 %); null = `DEFAULT_ORDER_PRICE_CENTS`.
   */
  order_price_cents?: Integer.Min<0> | null;
  /**
   * Percent of `order_price_cents` billed for an order placed on the public menu; null = `DEFAULT_WEB_ORDER_PERCENT`.
   */
  web_order_percent?: Integer.Range<0, 100> | null;
  /**
   * Order codes: null = random. `order_seq` is the last sequential number given (starts at 1).
   */
  order_code_mode?: OrderCodeMode | null;
  order_seq?: Integer.Min<0> | null;
  /**
   * Who pays for this store (`billing_accounts`); null until first use (`BillingAccounts.ensure`).
   */
  billing_account_id?: String.UUID | null;
  /**
   * Legacy: copied to the store's billing account on first use, then unused (`DROP COLUMN` is manual).
   */
  asaas_customer_id?: string | null;
  asaas_subscription_id?: string | null;
  card_brand?: string | null;
  card_last4?: string | null;
  /**
   * An invoice stayed unpaid past the grace days: the bot stops (like inactive) until it is paid.
   */
  billing_blocked?: boolean | null;
  /**
   * Daily low-stock digest: WhatsApp phone (digits, `normalizePhone`), local hour 0-23 (null = 9) and the local date
   * (`YYYY-MM-DD`) of the last digest sent.
   */
  stock_alert_phone?: string | null;
  stock_alert_hour?: Integer.Range<0, 23> | null;
  stock_alert_sent_on?: string | null;
  /**
   * Delivery lead time in days, told by the bot only when the store has `delivery_hours`; null = 1 day.
   */
  delivery_lead_days?: Integer.Range<1, 90> | null;
  /**
   * Counter POS defaults; null = grid layout, cash control on, blind close off, 80 mm receipt (only 58 or 80 are valid).
   */
  pos_layout?: 'grid' | 'search' | null;
  pos_cash_control?: boolean | null;
  pos_blind_close?: boolean | null;
  pos_receipt_width?: Integer.Range<58, 80> | null;
  /**
   * Employees (PIN): minutes of inactivity before the panel locks (1-240, null = 15) and the highest discount a
   * non-manager may give, in percent (0-100, null = 10).
   */
  staff_idle_minutes?: Integer.Range<1, 240> | null;
  staff_discount_limit_percent?: Integer.Range<0, 100> | null;
  /**
   * What a courier earns per delivery: the order's delivery fee (null = `order_fee`) or a fixed amount.
   */
  courier_fee_mode?: 'order_fee' | 'fixed' | null;
  courier_fee_cents?: Integer.Min<0> | null;
  /**
   * Menu (food) or catalog (retail) voice.
   */
  store_type: Enum.Default<StoreType, StoreType.Food>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
