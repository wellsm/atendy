export const enum CashMovementKind {
  /**
   * Money given back on a canceled sale, by method; only the cash part leaves the drawer.
   */
  Refund = 'refund',
  /**
   * Cash of a WhatsApp/web order completed on the board (the driver or the pickup brings it to the drawer).
   */
  OrderCash = 'order_cash',
  /**
   * Cash taken out of the drawer.
   */
  Sangria = 'sangria',
  /**
   * Cash put into the drawer.
   */
  Suprimento = 'suprimento',
  /**
   * Fees paid in cash to a courier at settlement (money out).
   */
  CourierPayout = 'courier_payout'
}
