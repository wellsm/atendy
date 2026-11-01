import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * One settlement of a courier's delivered orders: the fees owed and the cash the courier collected, frozen when it was
 * made. `cash_movement_id` is the `courier_payout` drawer movement, null when no payout was recorded.
 */
export interface CourierSettlementSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  courier_id: String.UUID;
  orders_count: Integer.Min<1>;
  fees_cents: Integer.Min<0>;
  cash_cents: Integer.Min<0>;
  cash_movement_id?: String.UUID | null;
  settled_by: string;
  created_at: String.DateTime;
}
