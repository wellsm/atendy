import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * Consumption of a stock item per unit sold of a product or of an option (exactly one of the two is set).
 */
export interface StockLinkSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  stock_item_id: String.UUID;
  product_id?: String.UUID | null;
  option_id?: String.UUID | null;
  qty: Integer.Min<1>;
}
