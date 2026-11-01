import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';
import type { Discount, Fulfillment, OrderSource, OrderStatus } from '../types';

export interface OrderSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  /**
   * Null only on POS sales without a customer.
   */
  customer_id?: String.UUID | null;
  /**
   * Null only on POS sales.
   */
  conversation_id?: String.UUID | null;
  status: OrderStatus;
  /**
   * Shown to the store and the customer (`#K7Q2MX` / `#128`), given when first placed; null on drafts and on orders
   * placed before codes existed.
   */
  code?: string | null;
  /**
   * Null: WhatsApp (bot or attendant).
   */
  source?: OrderSource | null;
  fulfillment?: Fulfillment | null;
  address?: string | null;
  neighborhood?: string | null;
  /**
   * Customer location (WhatsApp pin or geocoded address) and straight-line distance to the store, for distance
   * delivery.
   */
  latitude?: number | null;
  longitude?: number | null;
  distance_meters?: Integer.Min<0> | null;
  /**
   * The location came from a WhatsApp pin (kept over typed addresses); false = geocoded from the typed address.
   */
  location_pinned?: boolean | null;
  payment_method?: PaymentMethod | null;
  change_for_cents?: Integer.Min<0> | null;
  /**
   * Line totals after their discounts; `total` = subtotal − order discount + fee + surcharge.
   */
  subtotal_cents: Integer.Min<0>;
  fee_cents: Integer.Min<0>;
  total_cents: Integer.Min<0>;
  discount?: Discount | null;
  surcharge_cents?: Integer.Min<0> | null;
  /**
   * POS: name typed for a sale without a customer row.
   */
  customer_name?: string | null;
  /**
   * POS: label of a held sale.
   */
  pos_label?: string | null;
  notes?: string | null;
  cash_session_id?: String.UUID | null;
  canceled_reason?: string | null;
  canceled_by?: string | null;
  /**
   * POS: when the sale was canceled (a closed cash session keeps sales canceled after its close as sold).
   */
  canceled_at?: String.DateTime | null;
  /**
   * POS: the Clerk user who rang the sale.
   */
  created_by?: string | null;
  /**
   * Delivery orders: the courier who took it, the fee frozen at dispatch, and the hand-over (position when the
   * courier pressed "Entreguei", if the browser gave it). `courier_settlement_id` is for the later settlement.
   */
  courier_id?: String.UUID | null;
  courier_fee_cents?: Integer.Min<0> | null;
  dispatched_at?: String.DateTime | null;
  delivered_at?: String.DateTime | null;
  delivered_lat?: number | null;
  delivered_lng?: number | null;
  courier_settlement_id?: String.UUID | null;
  placed_at?: String.DateTime | null;
  /**
   * Abandoned drafts: the customer's last message before the order memory window ran out.
   */
  abandoned_at?: String.DateTime | null;
  /**
   * Last change made by the customer after placing (the store panel flags "pedido alterado").
   */
  amended_at?: String.DateTime | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
