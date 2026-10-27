import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { ProspectPauseReason } from '../types';

/**
 * The single Evolution number that sends prospecting messages (`id = 'default'`), with its pace and scheduler state.
 */
export interface ProspectingSenderSchema extends Database.Schema {
  id: string;
  whatsapp_instance?: string | null;
  /**
   * Per-instance token; never leaves the API.
   */
  whatsapp_instance_token?: string | null;
  /**
   * Secret in the webhook URL of this sender.
   */
  webhook_secret: string;
  /**
   * Last known connection state.
   */
  connected: boolean;
  /**
   * Starts false (new senders send as soon as connected and a lead is queued); the admin or a brake can pause it.
   */
  paused: boolean;
  pause_reason?: ProspectPauseReason | null;
  max_daily: Integer.Min<0>;
  window_start_hour: Integer.Range<0, 23>;
  window_end_hour: Integer.Range<1, 24>;
  /**
   * `Date.getUTCDay` numbers (0 = Sunday) the window is open.
   */
  weekdays: Integer.Range<0, 6>[];
  next_send_at?: String.DateTime | null;
  consecutive_failures: Integer.Min<0>;
  first_sent_at?: String.DateTime | null;
  /**
   * Set on every manual resume: the low-reply brake only counts leads sent after it.
   */
  brake_since?: String.DateTime | null;
}
