import type { MenuProduct } from '../../src/menu/repository';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { searchMenu } from '../../src/menu/search';
import { PriceMode } from '../../src/menu/types';

const product = (id: string, name: string, category: string, options: [string, boolean][] = []): MenuProduct => ({
  id,
  name,
  category_id: `c-${category}`,
  category,
  description: null,
  price_cents: 0,
  active: true,
  groups: options.length
    ? [
        {
          id: `${id}-g`,
          name: 'Sabores',
          min: 1,
          max: 2,
          price_mode: PriceMode.Max,
          options: options.map(([name, active], index) => ({
            id: `${id}-o${index}`,
            name,
            price_delta_cents: 1000,
            active
          }))
        }
      ]
    : []
});

const menu = [
  product('grande', 'Pizza Grande', 'Pizzas', [
    ['Calabresa', true],
    ['Frango com Catupiry', true],
    ['Atum', false]
  ]),
  product('calabresa', 'Pizza Calabresa Especial', 'Pizzas'),
  product('coca', 'Coca-Cola 2L', 'Bebidas'),
  product('guarana', 'Guaraná Antarctica 2L', 'Bebidas')
];

const ids = (products: MenuProduct[]) => products.map(({ id }) => id);

describe('searchMenu', () => {
  it('ranks a name match above an option match', () => {
    deepEqual(ids(searchMenu(menu, 'quero uma calabresa')), ['calabresa', 'grande']);
  });

  it('ignores accents, case and plural', () => {
    deepEqual(ids(searchMenu(menu, 'GUARANA')), ['guarana']);
    deepEqual(ids(searchMenu(menu, 'duas pizzas grandes')), ['grande', 'calabresa']);
  });

  it('does not match inactive options', () => {
    deepEqual(ids(searchMenu(menu, 'atum')), []);
  });

  it('returns nothing for a query without meaningful words', () => {
    deepEqual(ids(searchMenu(menu, 'oi, quero sim por favor')), []);
    deepEqual(ids(searchMenu(menu, '')), []);
  });

  it('respects the limit', () => {
    deepEqual(ids(searchMenu(menu, 'pizza', 1)), ['grande']);
  });
});
