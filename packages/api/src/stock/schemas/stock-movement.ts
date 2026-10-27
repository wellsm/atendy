import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { StockMovementKind } from '../types';

/**
 * One change of a stock item's balance, in base units (signed). `balance_after` is the balance it left.
 */
export interface StockMovementSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  stock_item_id: String.UUID;
  kind: StockMovementKind;
  qty_delta: Integer.Range<-2147483648, 2147483647>;
  balance_after: Integer.Range<-2147483648, 2147483647>;
  unit_cost_millicents?: Integer.Min<0> | null;
  order_id?: String.UUID | null;
  reason?: string | null;
  note?: string | null;
  author: string;
  created_at: String.DateTime;
}
