import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';

/**
 * One WhatsApp code sent to confirm a phone before a web order. Rows without `order_id` are codes we paid for that
 * never became an order.
 */
export interface PhoneVerificationSchema extends Database.Schema {
  id: String.UUID;
  /**
   * Store whose menu asked for the code.
   */
  store_id: String.UUID;
  phone: string;
  /**
   * HMAC of the code (never the code itself).
   */
  code_hash: string;
  attempts: Integer.Min<0>;
  /**
   * HMAC of the caller IP (rate limit only); null when the gateway gave none.
   */
  ip_hash?: string | null;
  verified_at?: String.DateTime | null;
  /**
   * WhatsApp message id (`wamid…`) Meta gave on send: its webhook statuses find the row by it.
   */
  message_id?: string | null;
  /**
   * Last WhatsApp status (`sent`, `delivered`, `read`, `failed`) and, when failed, Meta's code and title.
   */
  delivery_status?: string | null;
  delivery_error?: string | null;
  /**
   * Web order placed with this verification.
   */
  order_id?: String.UUID | null;
  expires_at: String.DateTime;
  created_at: String.DateTime;
}
