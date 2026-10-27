import type { Database } from '@ez4/database';
import type { Integer, Object, String } from '@ez4/schema';
import type { ProspectSituation, ProspectStatus, ProspectSystem } from '../types';

/**
 * One business to message once, in `position` order. Replies are never stored, only `replied_at`.
 */
export interface ProspectLeadSchema extends Database.Schema {
  id: String.UUID;
  import_id: String.UUID;
  /**
   * Global send order, increasing across imports.
   */
  position: Integer.Min<1>;
  /**
   * Digits with 55; unique.
   */
  phone: string;
  name: string;
  /**
   * Flat key/value data shown read-only.
   */
  info: Object.Any;
  /**
   * 2 to 4 candidate first messages.
   */
  messages: string[];
  /**
   * The text actually sent.
   */
  sent_message?: string | null;
  provider_message_id?: string | null;
  status: ProspectStatus;
  failure_reason?: string | null;
  sent_at?: String.DateTime | null;
  delivered_at?: String.DateTime | null;
  read_at?: String.DateTime | null;
  replied_at?: String.DateTime | null;
  note?: string | null;
  category?: string | null;
  neighborhood?: string | null;
  zone?: string | null;
  city?: string | null;
  postal_code?: string | null;
  situation?: ProspectSituation | null;
  /**
   * Detected ordering systems: `{ name, kind, source? }` items (`ProspectSystem`).
   */
  systems?: ProspectSystem[] | null;
  rating?: number | null;
  reviews?: Integer.Min<0> | null;
  /**
   * Priority hint from the import; higher is better.
   */
  score?: Integer.Range<0, 10> | null;
  site?: string | null;
  mobile?: boolean | null;
  /**
   * When the lead entered the queue; set on `queued`, cleared on `available`.
   */
  queued_at?: String.DateTime | null;
  /**
   * Last status change; a `sending` lead untouched for too long is stuck.
   */
  updated_at: String.DateTime;
}
