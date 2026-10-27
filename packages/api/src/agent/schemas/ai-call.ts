import type { Database } from '@ez4/database';
import type { Decimal, Integer, String } from '@ez4/schema';
import type { AiPath, AiProvider, AiToolTrace } from '../types';

export interface AiCallSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  conversation_id: String.UUID;
  provider: AiProvider;
  model: string;
  path: AiPath;
  intent?: string | null;
  confidence?: Decimal.Any | null;
  input_tokens: Integer.Min<0>;
  output_tokens: Integer.Min<0>;
  cost_usd: Decimal.Any;
  latency_ms: Integer.Min<0>;
  /**
   * `PROMPT_VERSION` of the code that made the call; null on rows written before it existed.
   */
  prompt_version?: string | null;
  /**
   * Tools this call asked for and their outcome; null when it asked for none.
   */
  tools?: AiToolTrace[] | null;
  created_at: String.DateTime;
}
