import type { Database } from '@ez4/database';
import type { Object, String } from '@ez4/schema';
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
  /**
   * Raw WhatsApp `{ key, message }` of a voice note until the inbound queue downloads it (the provider fetches the
   * audio from it); cleared after the attempt.
   */
  voice_note?: Object.Any | null;
  /**
   * `VoiceNotes` bucket key of the downloaded voice note, played in the panel.
   */
  audio_key?: string | null;
  /**
   * The customer's current reaction to this message (emoji), shown on its bubble.
   */
  reaction?: string | null;
  processed_at?: String.DateTime | null;
  created_at: String.DateTime;
}
