import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { ImportRowError } from '../import';

/**
 * One uploaded lead file and what became of its rows.
 */
export interface ProspectImportSchema extends Database.Schema {
  id: String.UUID;
  created_at: String.DateTime;
  total: Integer.Min<0>;
  added: Integer.Min<0>;
  skipped_duplicate: Integer.Min<0>;
  skipped_invalid: Integer.Min<0>;
  /**
   * First row errors only (capped).
   */
  errors: ImportRowError[];
}
