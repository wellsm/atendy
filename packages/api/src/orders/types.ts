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
  Web = 'web'
}

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
