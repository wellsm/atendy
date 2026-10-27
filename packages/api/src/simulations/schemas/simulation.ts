import type { Database } from '@ez4/database';
import type { Decimal, Integer, String } from '@ez4/schema';
import type { SimulationCheck, SimulationStatus } from '../types';

/**
 * One simulated conversation: a scenario (one of its repeats) played by a fake customer.
 */
export interface SimulationSchema extends Database.Schema {
  id: String.UUID;
  run_id: String.UUID;
  store_id: String.UUID;
  scenario_id: string;
  /**
   * The parsed `Scenario` as JSON text.
   */
  scenario: string;
  repeat_index: Integer.Min<0>;
  /**
   * Fake customer phone; the reply JID is `<phone>@sim`.
   */
  phone: string;
  /**
   * Set when the first customer message is stored.
   */
  conversation_id?: String.UUID | null;
  status: SimulationStatus;
  /**
   * Customer batches sent.
   */
  turns: Integer.Min<0>;
  checks?: SimulationCheck[] | null;
  /**
   * Customer model and judge costs (USD). Kept out of `ai_calls`, which holds only the bot's.
   */
  customer_cost_usd: Decimal.Any;
  judge_cost_usd: Decimal.Any;
  error?: string | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
  finished_at?: String.DateTime | null;
}
