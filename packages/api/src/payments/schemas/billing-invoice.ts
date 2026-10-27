import type { Database } from '@ez4/database';
import type { Integer, String } from '@ez4/schema';
import type { InvoiceStatus } from '../types';

/**
 * One closed billing cycle of a store: the usage it charges and the Asaas payment that charges it.
 */
export interface BillingInvoiceSchema extends Database.Schema {
  id: String.UUID;
  store_id: String.UUID;
  /**
   * Cycle bounds (day 1 00:00, UTC−3). Records created before `period_end` and not invoiced yet are included.
   */
  period_start: String.DateTime;
  period_end: String.DateTime;
  orders: Integer.Min<0>;
  amount_cents: Integer.Min<0>;
  /**
   * Charge date (YYYY-MM-DD).
   */
  due_date: String.Date;
  status: InvoiceStatus;
  /**
   * Null until a payment exists (no card on file at close).
   */
  asaas_payment_id?: string | null;
  invoice_url?: string | null;
  failure_reason?: string | null;
  paid_at?: String.DateTime | null;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
