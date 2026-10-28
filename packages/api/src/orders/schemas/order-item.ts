import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { StockUsage } from '../../stock/types';
import type { Discount, OptionsSnapshot } from '../types';

export interface OrderItemSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  order_id: String.UUID;
  product_id: String.UUID;
  product_name: string;
  qty: Integer.Min<1>;
  unit_price_cents: Integer.Min<0>;
  discount?: Discount | null;
  options_snapshot: OptionsSnapshot;
  notes?: string | null;
  stock_usage?: StockUsage | null;
  created_at: String.DateTime;
}
