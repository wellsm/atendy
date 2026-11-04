import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/**
 * Who pays for one or more stores: one card subscription and one monthly charge for all of them.
 */
export interface BillingAccountSchema extends Database.Schema {
  id: String.UUID;
  /**
   * Clerk user who owns the stores; null until known (admin-created stores before their first user).
   */
  owner_user_id?: string | null;
  /**
   * Asaas customer and the card subscription that charges each cycle; brand/last 4 only, never the card.
   */
  asaas_customer_id?: string | null;
  asaas_subscription_id?: string | null;
  card_brand?: string | null;
  card_last4?: string | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
