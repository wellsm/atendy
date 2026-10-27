import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface ConnectionSchema extends Database.Schema {
  /**
   * API Gateway connection id.
   */
  connection_id: string;

  /**
   * Store the connection is watching.
   */
  store_id: string;

  /**
   * Clerk user id.
   */
  user_id: string;

  created_at: String.DateTime;

  /**
   * Epoch seconds after which DynamoDB removes the record.
   */
  expire_at: number;
}
