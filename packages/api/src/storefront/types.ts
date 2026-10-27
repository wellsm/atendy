import type { Integer, String } from '@ez4/schema';
import type { PriceMode } from '../menu/types';
import type { Fulfillment } from '../orders/types';
import type { DeliveryMode, PaymentMethod } from '../stores/types';

export type StorefrontStore = {
  name: string;
  slug: string;
  /**
   * The hours say open and the store is accepting orders.
   */
  open: boolean;
  /**
   * End of the range open now (`HH:MM`), null when closed by the hours.
   */
  closesAt: string | null;
  /**
   * Cheapest fee of the delivery mode; null when the mode has no fee configured.
   */
  deliveryFromCents: number | null;
  minOrderCents: number | null;
  paymentMethods: PaymentMethod[];
  /**
   * How the delivery fee is set: the checkout asks the bairro (`by_zone`) or the location (`by_distance`).
   */
  deliveryMode: DeliveryMode;
};

export type StorefrontOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  /**
   * Off in the panel: the customer cannot choose it.
   */
  active: boolean;
  /**
   * Stock ran out today (computed); still listed.
   */
  soldOut: boolean;
  /**
   * Signed read URL (1 h); null without a photo.
   */
  imageUrl: string | null;
};

export type StorefrontGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: StorefrontOption[];
};

export type StorefrontProduct = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  soldOut: boolean;
  /**
   * Signed read URL (1 h); null without a photo.
   */
  imageUrl: string | null;
  groups: StorefrontGroup[];
};

export type StorefrontCategory = {
  id: string;
  name: string;
  products: StorefrontProduct[];
};

export type WebOrderItemInput = {
  productId: String.UUID;
  qty: Integer.Range<1, 99>;
  selections: { groupId: String.UUID; optionIds: String.UUID[] }[];
  notes?: String.Size<0, 200> | null;
};

export type WebOrderDeliveryInput = {
  fulfillment: Fulfillment;
  address?: String.Size<0, 200> | null;
  neighborhood?: String.Size<0, 80> | null;
  location?: { latitude: number; longitude: number } | null;
};

export const toWebItems = (items: WebOrderItemInput[]) =>
  items.map(({ productId, qty, selections, notes }) => ({
    productId,
    qty,
    notes,
    selections: selections.map(({ groupId, optionIds }) => ({ group_id: groupId, option_ids: optionIds }))
  }));
