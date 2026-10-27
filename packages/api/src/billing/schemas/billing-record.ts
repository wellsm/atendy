import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { BillingStep } from '../progress';
import type { BillingOutcome } from '../types';

/**
 * One billable order cycle of a conversation: what the AI finished and what the store pays for it.
 */
export interface BillingRecordSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  conversation_id: String.UUID;
  /**
   * Null when the conversation went to a person before any draft existed.
   */
  order_id?: String.UUID | null;
  outcome: BillingOutcome;
  handoff_reason?: string | null;
  steps: BillingStep[];
  percent: Integer.Range<0, 100>;
  /**
   * Store price per order when billed (snapshot: a later price change never rewrites history).
   */
  price_cents: Integer.Min<0>;
  amount_cents: Integer.Min<0>;
  /**
   * Part of `amount_cents` already charged: a record raised after its invoice closed bills only the difference.
   */
  invoiced_cents?: Integer.Min<0> | null;
  /**
   * Last invoice that charged it.
   */
  invoice_id?: String.UUID | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
