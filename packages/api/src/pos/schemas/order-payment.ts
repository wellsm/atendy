import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';

/**
 * One payment of a POS sale. `amount_cents` is what it covers of the total; cash also keeps what was handed over
 * and the change given.
 */
export interface OrderPaymentSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  order_id: String.UUID;
  method: PaymentMethod;
  amount_cents: Integer.Min<1>;
  received_cents?: Integer.Min<1> | null;
  change_cents?: Integer.Min<0> | null;
  created_at: String.DateTime;
}
