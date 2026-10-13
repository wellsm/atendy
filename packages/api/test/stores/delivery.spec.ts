import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Fulfillment } from '../../src/orders/types';
import { normalizeNeighborhood, resolveDeliveryFee } from '../../src/stores/delivery';
import { DeliveryMode } from '../../src/stores/types';

const zones = [
  { neighborhood: 'Sao Jose', fee_cents: 700 },
  { neighborhood: 'Centro', fee_cents: 0 }
];

describe('normalizeNeighborhood', () => {
  it('ignores accents, case and extra spaces', () => {
    equal(normalizeNeighborhood('  São  José '), 'sao jose');
  });
});

describe('resolveDeliveryFee', () => {
  const base = { deliveryMode: DeliveryMode.ByZone, flatFeeCents: 500, zones };

  it('is free for pickup', () => {
    equal(resolveDeliveryFee({ ...base, fulfillment: Fulfillment.Pickup }), 0);
  });

  it('uses the flat fee in flat mode regardless of neighborhood', () => {
    equal(
      resolveDeliveryFee({
        ...base,
        deliveryMode: DeliveryMode.Flat,
        fulfillment: Fulfillment.Delivery,
        neighborhood: 'Qualquer'
      }),
      500
    );
  });

  it('matches a zone typed with accents and spaces', () => {
    equal(resolveDeliveryFee({ ...base, fulfillment: Fulfillment.Delivery, neighborhood: '  São  José ' }), 700);
  });

  it('keeps a zero-fee zone as zero, not as not served', () => {
    equal(resolveDeliveryFee({ ...base, fulfillment: Fulfillment.Delivery, neighborhood: 'centro' }), 0);
  });

  it('returns undefined for a neighborhood that is not served or missing', () => {
    equal(resolveDeliveryFee({ ...base, fulfillment: Fulfillment.Delivery, neighborhood: 'Longe' }), undefined);
    equal(resolveDeliveryFee({ ...base, fulfillment: Fulfillment.Delivery }), undefined);
  });
});
