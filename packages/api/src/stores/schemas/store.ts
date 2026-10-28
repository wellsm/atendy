import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type {
  DeliveryMode,
  OrderCodeMode,
  PaymentMethod,
  RouterType,
  StorePolicy,
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
  accepting_orders: boolean;
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
   * Asaas customer and the card subscription that charges each cycle; brand/last 4 only, never the card.
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
   * Counter POS defaults; null = grid layout, cash control on, blind close off, 80 mm receipt (only 58 or 80 are valid).
   */
  pos_layout?: 'grid' | 'search' | null;
  pos_cash_control?: boolean | null;
  pos_blind_close?: boolean | null;
  pos_receipt_width?: Integer.Range<58, 80> | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
