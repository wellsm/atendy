import { equal, match } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { slugify } from '../../src/panel/slug';

describe('slugify', () => {
  it('lowercases, strips accents and symbols, and adds a random suffix', () => {
    match(slugify('Pizzaria São João!'), /^pizzaria-sao-joao-[0-9a-f]{4}$/);
  });

  it('falls back to "loja" when nothing usable is left', () => {
    match(slugify('!!!'), /^loja-[0-9a-f]{4}$/);
  });

  it('caps the base at 40 characters', () => {
    const slug = slugify('a'.repeat(100));

    equal(slug.length, 45);
  });
});
