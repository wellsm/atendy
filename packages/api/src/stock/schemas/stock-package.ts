import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * A way an item is bought: `factor` base units per package.
 */
export interface StockPackageSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  stock_item_id: String.UUID;
  name: string;
  factor: Integer.Min<2>;
  barcode?: string | null;
}
