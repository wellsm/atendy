import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PriceMode } from '../types';

/**
 * A store's option group, linked to products through `product_groups`.
 */
export interface OptionGroupSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  name: string;
  /**
   * Default limits for the next product linked (the last saved ones); each link has its own.
   */
  min: Integer.Min<0>;
  max: Integer.Min<1>;
  price_mode: PriceMode;
  /**
   * Legacy owner from before `product_groups` (null for new groups); read only by the backfill. Drop after it.
   */
  product_id?: String.UUID | null;
  /**
   * Legacy, like `product_id`.
   */
  position?: Integer.Min<0> | null;
}
