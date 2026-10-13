import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

export interface ProductSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  category_id: String.UUID;
  name: string;
  description?: string | null;
  price_cents: Integer.Min<0>;
  active: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
