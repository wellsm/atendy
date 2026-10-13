import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

export interface DeliveryZoneSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  neighborhood: string;
  fee_cents: Integer.Min<0>;
}
