import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface CustomerSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  /**
   * E.164 without `+`, e.g. `5511999998888`.
   */
  phone: string;
  /**
   * Address used to reply (`…@s.whatsapp.net` or `…@lid`). The phone alone is not enough for `@lid` contacts.
   */
  whatsapp_jid: string;
  name?: string | null;
  last_address?: string | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
