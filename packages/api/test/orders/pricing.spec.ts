import type { PricingProduct } from '../../src/orders/pricing';

import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PriceMode } from '../../src/menu/types';
import { computeTotals, priceItem, PricingErrorCode, validateChange } from '../../src/orders/pricing';

const pizza: PricingProduct = {
  id: 'p-large',
  name: 'Pizza Grande',
  price_cents: 0,
  active: true,
  groups: [
    {
      id: 'g-flavors',
      name: 'Sabores',
      min: 1,
      max: 2,
      price_mode: PriceMode.Max,
      options: [
        { id: 'o-mussarela', name: 'Mussarela', price_delta_cents: 5000, active: true },
        { id: 'o-calabresa', name: 'Calabresa', price_delta_cents: 5500, active: true },
        { id: 'o-camarao', name: 'Camarão', price_delta_cents: 8000, active: true },
        { id: 'o-off', name: 'Sem estoque', price_delta_cents: 4000, active: false }
      ]
    },
    {
      id: 'g-crust',
      name: 'Borda',
      min: 0,
      max: 1,
      price_mode: PriceMode.Sum,
      options: [{ id: 'o-catupiry', name: 'Catupiry', price_delta_cents: 1000, active: true }]
    }
  ]
};

const expectCode = (code: PricingErrorCode) => (error: unknown) => {
  equal((error as { code?: string }).code, code);
  return true;
};

describe('priceItem', () => {
  it('charges the most expensive flavor in a max group and adds sum groups', () => {
    const result = priceItem(pizza, [
      { group_id: 'g-flavors', option_ids: ['o-mussarela', 'o-camarao'] },
      { group_id: 'g-crust', option_ids: ['o-catupiry'] }
    ]);

    equal(result.unit_price_cents, 9000);
    deepEqual(
      result.options_snapshot.map(({ group_name, options }) => [group_name, options.map(({ name }) => name)]),
      [
        ['Sabores', ['Mussarela', 'Camarão']],
        ['Borda', ['Catupiry']]
      ]
    );
  });

  it('accepts a single flavor in a group that allows two', () => {
    equal(priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['o-calabresa'] }]).unit_price_cents, 5500);
  });

  it('rejects more options than the group max', () => {
    throws(
      () => priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['o-mussarela', 'o-calabresa', 'o-camarao'] }]),
      expectCode(PricingErrorCode.AboveMax)
    );
  });

  it('rejects the same option twice', () => {
    throws(
      () => priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['o-mussarela', 'o-mussarela'] }]),
      expectCode(PricingErrorCode.DuplicateOption)
    );
  });

  it('rejects the same group sent twice instead of dropping the second one', () => {
    throws(
      () =>
        priceItem(pizza, [
          { group_id: 'g-flavors', option_ids: ['o-mussarela'] },
          { group_id: 'g-flavors', option_ids: ['o-camarao'] }
        ]),
      expectCode(PricingErrorCode.DuplicateGroup)
    );
  });

  it('treats a product as unavailable when a required group has no active options left', () => {
    const soldOut: PricingProduct = {
      ...pizza,
      groups: [
        { ...pizza.groups[0]!, options: pizza.groups[0]!.options.map((option) => ({ ...option, active: false })) }
      ]
    };

    throws(
      () => priceItem(soldOut, [{ group_id: 'g-flavors', option_ids: ['o-mussarela'] }]),
      expectCode(PricingErrorCode.ProductInactive)
    );
  });

  it('rejects a required group left empty', () => {
    throws(() => priceItem(pizza, []), expectCode(PricingErrorCode.BelowMin));
  });

  it('rejects an inactive option, an unknown option, an unknown group and an inactive product', () => {
    throws(
      () => priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['o-off'] }]),
      expectCode(PricingErrorCode.OptionInactive)
    );
    throws(
      () => priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['nope'] }]),
      expectCode(PricingErrorCode.UnknownOption)
    );
    throws(
      () => priceItem(pizza, [{ group_id: 'nope', option_ids: ['o-mussarela'] }]),
      expectCode(PricingErrorCode.UnknownGroup)
    );
    throws(
      () => priceItem({ ...pizza, active: false }, [{ group_id: 'g-flavors', option_ids: ['o-mussarela'] }]),
      expectCode(PricingErrorCode.ProductInactive)
    );
  });
});

describe('computeTotals', () => {
  it('multiplies quantity and adds the fee', () => {
    deepEqual(
      computeTotals(
        [
          { qty: 2, unit_price_cents: 5500 },
          { qty: 1, unit_price_cents: 700 }
        ],
        500
      ),
      { subtotal_cents: 11700, fee_cents: 500, total_cents: 12200 }
    );
  });
});

describe('validateChange', () => {
  it('accepts no change, exact change and change above the total', () => {
    validateChange(5000, null);
    validateChange(5000, 5000);
    validateChange(5000, 10000);
  });

  it('rejects change below the total', () => {
    throws(() => validateChange(5000, 2000), expectCode(PricingErrorCode.ChangeBelowTotal));
  });
});

describe('priceItem sold out', () => {
  const flavors = (product: PricingProduct) => product.groups[0]!;
  const calabresa = [{ group_id: 'g-flavors', option_ids: ['o-calabresa'] }];

  it('refuses a sold-out product unless the staff allows it', () => {
    const soldOut = { ...pizza, sold_out: true };

    throws(() => priceItem(soldOut, calabresa), expectCode(PricingErrorCode.SoldOut));
    equal(priceItem(soldOut, calabresa, { allowSoldOut: true }).unit_price_cents, 5500);
  });

  it('refuses a sold-out option unless the staff allows it', () => {
    const product: PricingProduct = {
      ...pizza,
      groups: [
        {
          ...flavors(pizza),
          options: flavors(pizza).options.map((option) =>
            option.id === 'o-calabresa' ? { ...option, sold_out: true } : option
          )
        }
      ]
    };

    throws(() => priceItem(product, calabresa), expectCode(PricingErrorCode.OptionSoldOut));
    equal(priceItem(product, calabresa, { allowSoldOut: true }).unit_price_cents, 5500);
  });

  it('reports sold out, not inactive, when a required group has no option left to sell', () => {
    const product: PricingProduct = {
      ...pizza,
      groups: [
        {
          ...flavors(pizza),
          options: [{ id: 'o-only', name: 'Única', price_delta_cents: 100, active: true, sold_out: true }]
        }
      ]
    };

    throws(() => priceItem(product, []), expectCode(PricingErrorCode.SoldOut));
    equal(
      priceItem(product, [{ group_id: 'g-flavors', option_ids: ['o-only'] }], { allowSoldOut: true }).unit_price_cents,
      100
    );
  });

  it('never lets allowSoldOut bypass an inactive product or option', () => {
    throws(
      () => priceItem({ ...pizza, active: false, sold_out: true }, calabresa, { allowSoldOut: true }),
      expectCode(PricingErrorCode.ProductInactive)
    );
    throws(
      () => priceItem(pizza, [{ group_id: 'g-flavors', option_ids: ['o-off'] }], { allowSoldOut: true }),
      expectCode(PricingErrorCode.OptionInactive)
    );
  });
});
