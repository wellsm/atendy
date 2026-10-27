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

  it('accepts the previous address mode and the statuses of an order to repeat', () => {
    deepEqual(parsePolicyPatch('{"previous_address":"on_request","repeat_order_statuses":["done","canceled"]}'), {
      previous_address: 'on_request',
      repeat_order_statuses: ['done', 'canceled']
    });
    deepEqual(parsePolicyPatch('{"previous_address":null,"repeat_order_statuses":[]}'), {
      previous_address: null,
      repeat_order_statuses: []
    });
  });

  it('accepts the orders-in-progress keys', () => {
    const categoryId = '3f2a1c4e-8b7d-4e6f-9a1b-2c3d4e5f6a7b';

    deepEqual(
      parsePolicyPatch(
        JSON.stringify({ new_order_after_status: 'out', add_on_category_ids: [categoryId], add_on_extra_minutes: 15 })
      ),
      { new_order_after_status: 'out', add_on_category_ids: [categoryId], add_on_extra_minutes: 15 }
    );

    deepEqual(parsePolicyPatch('{"add_on_category_ids":[],"new_order_after_status":null}'), {
      add_on_category_ids: [],
      new_order_after_status: null
    });

    throws(() => parsePolicyPatch('{"new_order_after_status":"placed"}'), PolicyError);
    throws(() => parsePolicyPatch('{"add_on_category_ids":["bebidas"]}'), PolicyError);
    throws(() => parsePolicyPatch(JSON.stringify({ add_on_category_ids: [categoryId, categoryId] })), PolicyError);
    throws(() => parsePolicyPatch('{"add_on_extra_minutes":-1}'), PolicyError);
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
      '{"previous_address":"always"}',
      '{"repeat_order_statuses":"done"}',
      '{"repeat_order_statuses":["draft"]}',
      '{"repeat_order_statuses":["done","done"]}',
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
