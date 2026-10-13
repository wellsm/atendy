import type { MenuImport } from './repository';

import { PriceMode } from './types';

/**
 * Demo pizzeria used by `admin/seed-demo`, tests and evals. Pizza prices live in the flavors
 * (base price 0), so half-and-half charges the most expensive flavor (`price_mode: max`).
 */
export const DEMO_MENU: MenuImport = {
  categories: [
    {
      name: 'Pizzas',
      products: [
        {
          name: 'Pizza Grande',
          description: '8 fatias. Até 2 sabores (meio a meio cobra o sabor mais caro).',
          price_cents: 0,
          groups: [
            {
              name: 'Sabores',
              min: 1,
              max: 2,
              price_mode: PriceMode.Max,
              options: [
                { name: 'Calabresa', price_delta_cents: 4990 },
                { name: 'Mussarela', price_delta_cents: 4590 },
                { name: 'Portuguesa', price_delta_cents: 5290 },
                { name: 'Frango com Catupiry', price_delta_cents: 5490 }
              ]
            },
            {
              name: 'Borda',
              min: 0,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Catupiry', price_delta_cents: 1000 },
                { name: 'Cheddar', price_delta_cents: 1000 }
              ]
            }
          ]
        },
        {
          name: 'Pizza Broto',
          description: '4 fatias. 1 sabor.',
          price_cents: 0,
          groups: [
            {
              name: 'Sabor',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Calabresa', price_delta_cents: 2990 },
                { name: 'Mussarela', price_delta_cents: 2790 }
              ]
            },
            {
              name: 'Borda',
              min: 0,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [{ name: 'Catupiry', price_delta_cents: 800 }]
            }
          ]
        }
      ]
    },
    {
      name: 'Bebidas',
      products: [
        { name: 'Coca-Cola 2L', price_cents: 1400 },
        { name: 'Guaraná Antarctica 2L', price_cents: 1200 }
      ]
    }
  ]
};
