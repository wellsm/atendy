import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';
import type { Fulfillment, OrderSource, OrderStatus } from '../types';

export interface OrderSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  customer_id: String.UUID;
  conversation_id: String.UUID;
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
  subtotal_cents: Integer.Min<0>;
  fee_cents: Integer.Min<0>;
  total_cents: Integer.Min<0>;
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
