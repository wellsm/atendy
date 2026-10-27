export const enum InvoiceStatus {
  /**
   * Closed, waiting for its charge date.
   */
  Pending = 'pending',
  Paid = 'paid',
  /**
   * Refused, or due without a card on file. After `GRACE_DAYS` the store is blocked.
   */
  Overdue = 'overdue',
  /**
   * Asaas risk analysis.
   */
  InReview = 'in_review'
}

/**
 * Below this, a cycle's amount carries over to the next one (card fees would eat it).
 */
export const MIN_CHARGE_CENTS = 1000;

/**
 * Days after the charge date an invoice may stay unpaid before the bot stops.
 */
export const GRACE_DAYS = 7;

/**
 * The cycle closes on day 1; Asaas charges on this day of the same month (time to set the amount first).
 */
export const CHARGE_DAY = 5;

export type BillingCard = {
  brand: string;
  last4: string;
};

export type BillingInvoice = {
  id: string;
  periodStart: string;
  periodEnd: string;
  orders: number;
  amountCents: number;
  dueDate: string;
  status: InvoiceStatus;
  failureReason: string | null;
  /**
   * Asaas page to pay it another way (Pix).
   */
  invoiceUrl: string | null;
  paidAt: string | null;
};

export type BillingSummary = {
  card: BillingCard | null;
  blocked: boolean;
  priceCents: number;
  /**
   * Usage not invoiced yet (this cycle plus carry-over).
   */
  open: {
    orders: number;
    amountCents: number;
  };
  invoices: BillingInvoice[];
};

/**
 * Holder data Asaas needs with the card (also used for the Asaas customer).
 */
export type CardHolderInput = {
  name: string;
  cpfCnpj: string;
  email: string;
  phone: string;
  postalCode: string;
  addressNumber: string;
};

export type CardInput = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};
