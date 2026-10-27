import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * Links a library group to a product. The group's name, price mode and options are shared; the choice limits and the
 * position are per product.
 */
export interface ProductGroupSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  product_id: String.UUID;
  group_id: String.UUID;
  min: Integer.Min<0>;
  max: Integer.Min<1>;
  position: Integer.Min<0>;
}
