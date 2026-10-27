import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { averageCost } from '../../src/stock/cost';

describe('averageCost', () => {
  it('weights the current balance and the entry', () => {
    equal(averageCost({ balance: 10, avg: 300000, qty: 10, unitCost: 400000 }), 350000);
  });

  it('uses the entry cost when the balance is zero or negative', () => {
    equal(averageCost({ balance: -2, avg: 300000, qty: 12, unitCost: 250000 }), 250000);
    equal(averageCost({ balance: 0, avg: 300000, qty: 5, unitCost: 100 }), 100);
  });

  it('uses the entry cost when there is no average yet', () => {
    equal(averageCost({ balance: 0, avg: null, qty: 3, unitCost: 1 }), 1);
    equal(averageCost({ balance: 4, avg: null, qty: 3, unitCost: 7 }), 7);
  });
});
