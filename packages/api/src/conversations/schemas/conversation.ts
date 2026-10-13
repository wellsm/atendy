import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { ConversationMode } from '../types';

export interface ConversationSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  customer_id: String.UUID;
  mode: ConversationMode;
  handoff_reason?: string | null;
  draft_order_id?: String.UUID | null;
  last_message_at: String.DateTime;
  created_at: String.DateTime;
}
