import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { MessageAuthor, MessageDirection } from '../types';

export interface MessageSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  conversation_id: String.UUID;
  direction: MessageDirection;
  author: MessageAuthor;
  body: string;
  /**
   * Provider message id. Unique per store: webhook redeliveries become no-ops.
   */
  provider_message_id: string;
  processed_at?: String.DateTime | null;
  created_at: String.DateTime;
}
