import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isValidSecret } from '../../src/whatsapp/secret';

describe('isValidSecret', () => {
  it('accepts only the exact secret', () => {
    equal(isValidSecret('abc123', 'abc123'), true);
    equal(isValidSecret('abc123', 'abc124'), false);
    equal(isValidSecret('abc123', 'abc'), false);
    equal(isValidSecret('abc123', undefined), false);
    equal(isValidSecret('abc123', ''), false);
  });
});
