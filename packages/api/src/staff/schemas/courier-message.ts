import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/**
 * A dispatch message sent to a courier from the store's number. Written before sending so the webhook can tell its
 * `fromMe` echo from the staff typing on the phone (`isCourierEcho`).
 */
export interface CourierMessageSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  phone: string;
  body: string;
  provider_message_id?: string | null;
  created_at: String.DateTime;
}
