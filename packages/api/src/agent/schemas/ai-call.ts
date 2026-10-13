import type { Database } from '@ez4/database';
import type { Decimal, Integer, String } from '@ez4/schema';
import type { AiPath, AiProvider } from '../types';

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
  created_at: String.DateTime;
}
