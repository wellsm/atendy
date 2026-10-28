import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * One drawer session: open with a float, closed with the counted cash. At most one open (`closed_at` null) per store;
 * a closed session never changes.
 */
export interface CashSessionSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  /**
   * Reserved for several drawers per store; null is the store's single drawer.
   */
  register_id?: String.UUID | null;
  opened_by: string;
  opened_at: String.DateTime;
  float_cents: Integer.Min<0>;
  closed_by?: string | null;
  closed_at?: String.DateTime | null;
  counted_cents?: Integer.Min<0> | null;
  /**
   * Expected cash at the close (snapshot). Signed: sangrias and refunds may exceed what came in.
   */
  expected_cents?: Integer.Range<-2147483648, 2147483647> | null;
  created_at: String.DateTime;
}
