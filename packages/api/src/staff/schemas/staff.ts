import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { StaffRole } from '../types';

/**
 * A store employee. PIN roles (cashier, kitchen, manager) unlock the shared panel; a courier has no PIN, only a
 * link token. `pin_version` goes up on every PIN change and deactivation so older sessions stop working.
 */
export interface StaffSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  name: string;
  role: StaffRole;
  pin_hash?: string | null;
  pin_version: Integer.Min<0>;
  failed_pins: Integer.Min<0>;
  blocked_until?: String.DateTime | null;
  delivers: boolean;
  phone?: string | null;
  courier_token?: string | null;
  active: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
