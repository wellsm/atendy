export const enum OrderStatus {
  Draft = 'draft',
  Placed = 'placed',
  Accepted = 'accepted',
  Out = 'out',
  Done = 'done',
  Canceled = 'canceled',
  /**
   * A draft the customer left: no message for longer than the store's order memory window.
   */
  Abandoned = 'abandoned'
}

/**
 * Where an order came from when not the WhatsApp conversation (null = WhatsApp, bot or attendant).
 */
export const enum OrderSource {
  Web = 'web',
  /**
   * Counter sale (POS): no conversation, optional customer.
   */
  Pos = 'pos'
}

/**
 * Discount on a line or on the whole order: integer cents (`value`, ≥ 1) or an integer percentage (`percent`, 1–100);
 * the POS validates it (`PosError('discount')`).
 */
export type Discount = { kind: 'value' | 'percent'; value: number };

export const enum Fulfillment {
  Delivery = 'delivery',
  Pickup = 'pickup'
}

export type OptionsSnapshot = {
  group_id: string;
  group_name: string;
  options: {
    id: string;
    name: string;
    price_delta_cents: number;
  }[];
}[];
