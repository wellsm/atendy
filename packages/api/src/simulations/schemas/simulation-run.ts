import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { RouterType } from '../../stores/types';

/**
 * One battery of simulated conversations against one store.
 */
export interface SimulationRunSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  name: string;
  /**
   * Scenario file as sent (YAML or JSON).
   */
  source: string;
  total: Integer.Min<1>;
  /**
   * Snapshots of what the bot ran with, to compare runs.
   */
  prompt_version: string;
  router: RouterType;
  llm_model: string;
  /**
   * Model that plays the customer (`SIMULATION_CUSTOMER_MODELS`).
   */
  customer_model: string;
  /**
   * Clerk user id of the admin who started it.
   */
  created_by: string;
  created_at: String.DateTime;
  finished_at?: String.DateTime | null;
}
