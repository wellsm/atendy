export const enum OrderErrorCode {
  UnknownProduct = 'unknown_product',
  ItemNotFound = 'item_not_found',
  NoDraft = 'no_draft',
  Incomplete = 'incomplete',
  PaymentNotAccepted = 'payment_not_accepted',
  NeedsHuman = 'needs_human',
  OrderLocked = 'order_locked',
  ChangeTooHigh = 'change_too_high',
  StoreClosing = 'store_closing',
  /**
   * Distance delivery without a location: the model asks for the WhatsApp location pin.
   */
  LocationNeeded = 'location_needed',
  NoSavedAddress = 'no_saved_address',
  NoPreviousOrder = 'no_previous_order',
  /**
   * The last order is not far enough along for another one (`new_order_after_status`).
   */
  PreviousOrderOpen = 'previous_order_open',
  /**
   * No order in the memory window that the store is preparing (`accepted`).
   */
  NoOrderInProgress = 'no_order_in_progress',
  /**
   * The product's category is not in the store's add-on categories.
   */
  NotAllowedAfterAccept = 'not_allowed_after_accept',
  /**
   * A tracked stock item cannot cover what the write adds; the message names the products/options.
   */
  OutOfStock = 'out_of_stock'
}

export class OrderError extends Error {
  constructor(
    public readonly code: OrderErrorCode,
    message: string,
    /**
     * Set when a human must take over: the tool hands the conversation off with this reason.
     */
    public readonly handoffReason?: string,
    /**
     * Out of stock: the product/option names, so the web checkout can word the message itself.
     */
    public readonly names?: string[]
  ) {
    super(message);
  }
}
