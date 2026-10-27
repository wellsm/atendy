import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { ConversationMode } from '../types';

export interface ConversationSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  customer_id: String.UUID;
  mode: ConversationMode;
  handoff_reason?: string | null;
  /**
   * A limit the bot hit and the store must approve (`APPROVAL_REASONS`): the bot waits, the customer sees nothing.
   */
  approval_reason?: string | null;
  /**
   * What the store approved for the current order; cleared when an order is placed.
   */
  approved_reason?: string | null;
  draft_order_id?: String.UUID | null;
  last_message_at: String.DateTime;
  created_at: String.DateTime;
}
