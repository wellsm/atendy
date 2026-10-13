import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

export interface OptionSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  group_id: String.UUID;
  name: string;
  price_delta_cents: Integer.Min<0>;
  active: boolean;
  position: Integer.Min<0>;
}
