import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeUsage, soldOutTargets } from '../../src/stock/usage';

describe('mergeUsage', () => {
  it('sums quantities per item and sorts by item id', () => {
    deepEqual(
      mergeUsage([
        [{ stock_item_id: 'b', qty: 1 }],
        [
          { stock_item_id: 'a', qty: 2 },
          { stock_item_id: 'b', qty: 1 }
        ]
      ]),
      [
        { stock_item_id: 'a', qty: 2 },
        { stock_item_id: 'b', qty: 2 }
      ]
    );
  });

  it('returns an empty usage for no parts', () => {
    deepEqual(mergeUsage([]), []);
  });
});

describe('soldOutTargets', () => {
  const links = [
    { stock_item_id: 'a', product_id: 'p1', qty: 6 },
    { stock_item_id: 'b', option_id: 'o1', qty: 1 }
  ];

  it('marks a product sold out when the balance is below the link quantity', () => {
    const result = soldOutTargets(
      links,
      new Map([
        ['a', 5],
        ['b', 3]
      ])
    );

    deepEqual([...result.soldOutProducts], ['p1']);
    deepEqual([...result.soldOutOptions], []);
  });

  it('keeps a product available when the balance covers the link quantity', () => {
    const result = soldOutTargets(
      links,
      new Map([
        ['a', 6],
        ['b', 3]
      ])
    );

    deepEqual([...result.soldOutProducts], []);
  });

  it('marks an option sold out when its item is empty', () => {
    const result = soldOutTargets(
      links,
      new Map([
        ['a', 9],
        ['b', 0]
      ])
    );

    deepEqual([...result.soldOutOptions], ['o1']);
  });
});
