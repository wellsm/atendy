import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { StockUnit } from '../types';

/**
 * A store's stock item. Quantities are integers in the base unit; costs in millicents per base unit.
 */
export interface StockItemSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  name: string;
  unit: StockUnit;
  barcode?: string | null;
  balance: Integer.Range<-2147483648, 2147483647>;
  min_qty?: Integer.Min<0> | null;
  avg_cost_millicents?: Integer.Min<0> | null;
  archived_at?: String.DateTime | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
