import type { GroupDraft, ProductDraft } from '../../src/menu/validation';

import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PriceMode } from '../../src/menu/types';
import { MAX_PRICE_CENTS, MenuError, validateCategoryName, validateProduct } from '../../src/menu/validation';

const failsOn = (field: string) => (error: unknown) => error instanceof MenuError && error.field === field;

const flavors = (): GroupDraft => ({
  name: ' Sabores ',
  min: 1,
  max: 2,
  priceMode: PriceMode.Max,
  options: [
    { name: ' Calabresa ', priceDeltaCents: 4990, active: true },
    { name: 'Portuguesa', priceDeltaCents: 5290, active: true }
  ]
});

const pizza = (overrides: Partial<ProductDraft> = {}): ProductDraft => ({
  categoryId: 'category-1',
  name: '  Pizza   Grande ',
  description: '',
  priceCents: 0,
  active: true,
  groups: [
    flavors(),
    {
      name: 'Borda',
      min: 0,
      max: 1,
      priceMode: PriceMode.Sum,
      options: [{ name: 'Catupiry', priceDeltaCents: 1000, active: true }]
    }
  ],
  ...overrides
});

const withGroup = (group: Partial<GroupDraft>) => pizza({ groups: [{ ...flavors(), ...group }] });

describe('menu validators', () => {
  it('trims and collapses category names', () => {
    equal(validateCategoryName('  Pizzas   Doces '), 'Pizzas Doces');
    throws(() => validateCategoryName('   '), failsOn('name'));
    throws(() => validateCategoryName('x'.repeat(81)), failsOn('name'));
  });

  it('normalizes a valid pizza', () => {
    const product = validateProduct(pizza());

    equal(product.name, 'Pizza Grande');
    equal(product.description, null);
    equal(product.groups[0]?.name, 'Sabores');
    deepEqual(
      product.groups[0]?.options.map(({ name }) => name),
      ['Calabresa', 'Portuguesa']
    );
    equal('id' in product.groups[0], false);
  });

  it('keeps sent ids', () => {
    const product = validateProduct(
      pizza({
        groups: [
          {
            ...flavors(),
            id: 'g1',
            max: 1,
            options: [{ id: 'o1', name: 'Calabresa', priceDeltaCents: 1, active: false }]
          }
        ]
      })
    );

    equal(product.groups[0]?.id, 'g1');
    equal(product.groups[0]?.options[0]?.id, 'o1');
  });

  it('refuses bad product fields', () => {
    throws(() => validateProduct(pizza({ name: ' ' })), failsOn('name'));
    throws(() => validateProduct(pizza({ priceCents: -1 })), failsOn('price_cents'));
    throws(() => validateProduct(pizza({ priceCents: 1.5 })), failsOn('price_cents'));
    throws(() => validateProduct(pizza({ priceCents: MAX_PRICE_CENTS + 1 })), failsOn('price_cents'));
    throws(() => validateProduct(pizza({ description: 'x'.repeat(301) })), failsOn('description'));
    throws(() => validateProduct(pizza({ groups: Array.from({ length: 11 }, flavors) })), failsOn('groups'));
  });

  it('refuses incoherent group rules', () => {
    throws(() => validateProduct(withGroup({ options: [] })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ name: '' })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ min: 2, max: 1 })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ max: 3 })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ min: 0, max: 0 })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ min: -1 })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ max: 1.5 })), failsOn('groups'));
    throws(() => validateProduct(withGroup({ priceMode: 'avg' as PriceMode })), failsOn('groups'));

    const options = Array.from({ length: 101 }, (_, index) => ({
      name: `Sabor ${index}`,
      priceDeltaCents: 0,
      active: true
    }));

    throws(() => validateProduct(withGroup({ options })), failsOn('groups'));
  });

  it('refuses bad options', () => {
    const option = { priceDeltaCents: 0, active: true };

    throws(
      () =>
        validateProduct(
          withGroup({
            options: [
              { ...option, name: 'Calabresa' },
              { ...option, name: 'calabresa ' }
            ]
          })
        ),
      failsOn('options')
    );
    throws(
      () =>
        validateProduct(
          withGroup({
            options: [
              { ...option, name: 'Atum' },
              { ...option, name: 'Atúm' }
            ]
          })
        ),
      failsOn('options')
    );
    throws(
      () => validateProduct(withGroup({ min: 0, max: 1, options: [{ ...option, name: '' }] })),
      failsOn('options')
    );
    throws(
      () => validateProduct(withGroup({ min: 0, max: 1, options: [{ ...option, name: 'A', priceDeltaCents: -1 }] })),
      failsOn('options')
    );
    throws(
      () =>
        validateProduct(
          withGroup({ min: 0, max: 1, options: [{ ...option, name: 'A', priceDeltaCents: MAX_PRICE_CENTS + 1 }] })
        ),
      failsOn('options')
    );
  });

  it('refuses repeated ids', () => {
    const option = { priceDeltaCents: 0, active: true };

    throws(
      () =>
        validateProduct(
          pizza({
            groups: [
              { ...flavors(), id: 'g1' },
              { ...flavors(), id: 'g1' }
            ]
          })
        ),
      failsOn('ids')
    );
    throws(
      () =>
        validateProduct(
          pizza({
            groups: [
              { ...flavors(), options: [{ ...option, id: 'o1', name: 'A' }], min: 1, max: 1 },
              { ...flavors(), name: 'Outro', min: 1, max: 1, options: [{ ...option, id: 'o1', name: 'B' }] }
            ]
          })
        ),
      failsOn('ids')
    );
  });
});
