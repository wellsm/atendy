import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatLocationBody, parseLocationBody } from '../../src/whatsapp/location';

describe('location body', () => {
  it('round-trips coordinates with 6 decimals', () => {
    const body = formatLocationBody({ latitude: -23.5505199, longitude: -46.6333081 });

    equal(body, '📍 Localização: -23.550520,-46.633308');
    deepEqual(parseLocationBody(body), { latitude: -23.55052, longitude: -46.633308 });
  });

  it('ignores anything that is not exactly a location body', () => {
    equal(parseLocationBody('minha localização: -23.5,-46.6'), undefined);
    equal(parseLocationBody('📍 Localização: 91,0'), undefined);
    equal(parseLocationBody('📍 Localização: abc'), undefined);
  });
});
