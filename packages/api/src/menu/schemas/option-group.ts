import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PriceMode } from '../types';

export interface OptionGroupSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  product_id: String.UUID;
  name: string;
  min: Integer.Min<0>;
  max: Integer.Min<1>;
  price_mode: PriceMode;
  position: Integer.Min<0>;
}
