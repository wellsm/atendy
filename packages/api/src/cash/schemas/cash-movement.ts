import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';
import type { CashMovementKind } from '../types';

/**
 * Money in or out of the drawer besides POS payments. `session_id` is null for order cash received while no session was
 * open, until the next session claims it.
 */
export interface CashMovementSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  session_id?: String.UUID | null;
  kind: CashMovementKind;
  method: PaymentMethod;
  amount_cents: Integer.Min<1>;
  reason?: string | null;
  author: string;
  order_id?: String.UUID | null;
  created_at: String.DateTime;
}
