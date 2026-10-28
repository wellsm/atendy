export const enum PosErrorCode {
  /**
   * The sale (or line) is not one of the store's POS sales.
   */
  NotFound = 'not_found',
  NotDraft = 'not_draft',
  Customer = 'customer',
  Discount = 'discount',
  Label = 'label',
  Payments = 'payments',
  Method = 'method',
  CashClosed = 'cash_closed',
  NoLines = 'no_lines',
  Reason = 'reason'
}

export class PosError extends Error {
  constructor(
    public readonly code: PosErrorCode,
    message: string
  ) {
    super(message);
  }
}
