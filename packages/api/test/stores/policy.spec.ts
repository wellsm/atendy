import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderMemorySince, parsePolicyPatch, PolicyError } from '../../src/stores/policy';

describe('parsePolicyPatch', () => {
  it('accepts limits, the SOP and null (clears a key)', () => {
    deepEqual(
      parsePolicyPatch(
        '{"max_item_qty":10,"min_order_cents":3000,"sop":"Borda só na grande.","max_change_cents":null}'
      ),
      { max_item_qty: 10, min_order_cents: 3000, sop: 'Borda só na grande.', max_change_cents: null }
    );
  });

  it('rejects bad JSON, non-objects, unknown keys and bad values', () => {
    const bad = [
      '{',
      '[]',
      '5',
      '{"max_items":1}',
      '{"max_item_qty":-1}',
      '{"max_item_qty":1.5}',
      '{"max_item_qty":"10"}',
      '{"sop":5}',
      JSON.stringify({ sop: 'a'.repeat(2001) })
    ];

    for (const raw of bad) {
      throws(() => parsePolicyPatch(raw), PolicyError, raw);
    }
  });
});

describe('orderMemorySince', () => {
  it('defaults to 3 hours and honours the store setting', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');

    equal(orderMemorySince(null, now), '2026-10-10T09:00:00.000Z');
    equal(orderMemorySince({}, now), '2026-10-10T09:00:00.000Z');
    equal(orderMemorySince({ order_memory_hours: 1 }, now), '2026-10-10T11:00:00.000Z');
  });
});
