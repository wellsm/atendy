import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { storefrontUrl } from '../../src/storefront/url';

describe('storefrontUrl', () => {
  it('joins the web origin and the slug, with or without a trailing slash', () => {
    equal(storefrontUrl('https://atendy.app', 'bella-massa-1a2b'), 'https://atendy.app/bella-massa-1a2b');
    equal(storefrontUrl('https://atendy.app//', 'bella'), 'https://atendy.app/bella');
  });
});
