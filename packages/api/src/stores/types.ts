export const enum RouterType {
  Jev = 'jev',
  Llm = 'llm'
}

export const enum WhatsAppProviderType {
  Evolution = 'evolution',
  CloudApi = 'cloud_api'
}

export const enum DeliveryMode {
  Flat = 'flat',
  ByZone = 'by_zone'
}

export const enum PaymentMethod {
  Pix = 'pix',
  Card = 'card',
  Cash = 'cash'
}

/**
 * Store guardrails. Missing or `null` means no limit (`order_memory_hours`: the default). Numbers are enforced in
 * code; `sop` is guidance for the model.
 */
export type StorePolicy = {
  /**
   * Per cart line.
   */
  max_item_qty?: number | null;
  /**
   * Order subtotal.
   */
  max_order_cents?: number | null;
  /**
   * Change = change_for - total.
   */
  max_change_cents?: number | null;
  /**
   * Order subtotal.
   */
  min_order_cents?: number | null;
  /**
   * First order of a customer above this total is placed and handed to a human.
   */
  new_customer_review_cents?: number | null;
  /**
   * Stop placing orders this many minutes before closing.
   */
  last_order_minutes?: number | null;
  /**
   * Window for the previous order and for history.
   */
  order_memory_hours?: number | null;
  sop?: string | null;
};
