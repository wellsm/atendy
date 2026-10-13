import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

export interface StoreHourSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  /**
   * 0 = Sunday … 6 = Saturday (store local time).
   */
  weekday: Integer.Range<0, 6>;
  /**
   * `HH:MM`, store local time.
   */
  opens_at: String.Regex<'^([01]\\d|2[0-3]):[0-5]\\d$', 'time'>;
  /**
   * `HH:MM`, store local time. `closes_at <= opens_at` means the range ends the next day.
   */
  closes_at: String.Regex<'^([01]\\d|2[0-3]):[0-5]\\d$', 'time'>;
}
