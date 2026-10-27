import { equal, ok, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { distanceMeters, pickBandFee } from '../../src/stores/geo';
import { SettingsError, validateBands } from '../../src/stores/settings';

const failsOn = (field: string) => (error: unknown) => error instanceof SettingsError && error.field === field;

describe('geo helpers', () => {
  it('measures a straight line in meters', () => {
    // Praça da Sé → Av. Paulista/MASP, about 3.0 km.
    const meters = distanceMeters(
      { latitude: -23.55052, longitude: -46.633308 },
      { latitude: -23.561414, longitude: -46.655881 }
    );

    ok(meters > 2500 && meters < 2700, `got ${meters}`);
    equal(distanceMeters({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }), 0);
  });

  it('picks the first band that covers the distance', () => {
    const bands = [
      { maxMeters: 2000, feeCents: 500 },
      { maxMeters: 5000, feeCents: 800 }
    ];

    equal(pickBandFee(bands, 0), 500);
    equal(pickBandFee(bands, 2000), 500);
    equal(pickBandFee(bands, 2001), 800);
    equal(pickBandFee(bands, 5000), 800);
    equal(pickBandFee(bands, 5001), undefined);
    equal(pickBandFee([], 10), undefined);
  });

  it('validates bands', () => {
    const band = (maxMeters: number, feeCents = 500) => ({ maxMeters, feeCents });

    throws(() => validateBands([]), failsOn('bands'));
    throws(() => validateBands(Array.from({ length: 11 }, (_, index) => band((index + 1) * 1000))), failsOn('bands'));
    throws(() => validateBands([band(2000), band(2000)]), failsOn('bands'));
    throws(() => validateBands([band(3000), band(2000)]), failsOn('bands'));
    throws(() => validateBands([band(99)]), failsOn('bands'));
    throws(() => validateBands([band(100_001)]), failsOn('bands'));
    throws(() => validateBands([band(1500.5)]), failsOn('bands'));
    throws(() => validateBands([band(2000, -1)]), failsOn('bands'));
    throws(() => validateBands([band(2000, 10_000_001)]), failsOn('bands'));
    equal(validateBands([band(2000, 0), band(5000)]).length, 2);
  });
});
