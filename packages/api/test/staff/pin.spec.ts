import { equal, notEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hashPin, verifyPin } from '../../src/staff/pin';

describe('staff PIN hashing', () => {
  it('salts each hash and verifies only the right PIN', async () => {
    const first = await hashPin('1234');
    const second = await hashPin('1234');

    notEqual(first, second);
    equal(await verifyPin('1234', first), true);
    equal(await verifyPin('1235', first), false);
    equal(await verifyPin('1234', 'garbage'), false);
  });
});
