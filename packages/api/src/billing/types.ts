export const enum BillingOutcome {
  Placed = 'placed',
  Handoff = 'handoff',
  /**
   * Placed by the customer on the public menu: the store's `web_order_percent`.
   */
  Web = 'web'
}
