export const enum OrderStatus {
  Draft = 'draft',
  Placed = 'placed',
  Accepted = 'accepted',
  Out = 'out',
  Done = 'done',
  Canceled = 'canceled'
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
