import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * One "até X metros → taxa" line of a store delivering by distance.
 */
export interface DeliveryBandSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  max_meters: Integer.Min<1>;
  fee_cents: Integer.Min<0>;
}
