import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

export interface CategorySchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  name: string;
  position: Integer.Min<0>;
}
