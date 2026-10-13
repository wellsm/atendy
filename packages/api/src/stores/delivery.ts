import { DeliveryMode } from './types';
import { Fulfillment } from '../orders/types';

/**
 * Lowercase, strip accents and collapse whitespace so "  São  José " matches "Sao Jose".
 */
export const normalizeNeighborhood = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
};

export type ResolveDeliveryFeeInput = {
  fulfillment: Fulfillment;
  deliveryMode: DeliveryMode;
  flatFeeCents: number;
  zones: { neighborhood: string; fee_cents: number }[];
  neighborhood?: string | null;
};

/**
 * Delivery fee in cents, or `undefined` when the neighborhood is not served.
 */
export const resolveDeliveryFee = (input: ResolveDeliveryFeeInput) => {
  if (input.fulfillment === Fulfillment.Pickup) {
    return 0;
  }

  if (input.deliveryMode === DeliveryMode.Flat) {
    return input.flatFeeCents;
  }

  if (!input.neighborhood) {
    return undefined;
  }

  const target = normalizeNeighborhood(input.neighborhood);

  return input.zones.find(({ neighborhood }) => normalizeNeighborhood(neighborhood) === target)?.fee_cents;
};
