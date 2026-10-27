import type { DeliverySettings } from '../stores/settings';

import { DeliveryMode } from '../stores/types';

/**
 * "Entrega a partir de": the cheapest fee of the active mode, null when that mode has no fee to show.
 */
export const deliveryFromCents = (delivery: DeliverySettings) => {
  if (delivery.mode === DeliveryMode.Flat) {
    return delivery.flatFeeCents;
  }

  const fees =
    delivery.mode === DeliveryMode.ByZone
      ? delivery.zones.map(({ feeCents }) => feeCents)
      : (delivery.bands ?? []).map(({ feeCents }) => feeCents);

  return fees.length ? Math.min(...fees) : null;
};
