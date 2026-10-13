import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';
import type { Fulfillment, OrderStatus } from '../types';

export interface OrderSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  customer_id: String.UUID;
  conversation_id: String.UUID;
  status: OrderStatus;
  fulfillment?: Fulfillment | null;
  address?: string | null;
  neighborhood?: string | null;
  payment_method?: PaymentMethod | null;
  change_for_cents?: Integer.Min<0> | null;
  subtotal_cents: Integer.Min<0>;
  fee_cents: Integer.Min<0>;
  total_cents: Integer.Min<0>;
  placed_at?: String.DateTime | null;
  /**
   * Last change made by the customer after placing (the store panel flags "pedido alterado").
   */
  amended_at?: String.DateTime | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
