import type { DemoStockItem, DemoStockLink } from '../../stock/types';
import type { MenuImport } from '../repository';

import { StockUnit } from '../../stock/types';
import { PriceMode } from '../types';

/**
 * A demo drink sold by the unit, bought in one package.
 */
export const drinkItem = (
  name: string,
  balance: number,
  minQty: number,
  costCents: number,
  pack: { name: string; factor: number }
): DemoStockItem => ({
  name,
  unit: StockUnit.Unit,
  min_qty: minQty,
  balance,
  unit_cost_millicents: costCents * 1000,
  packages: [pack]
});

export const takeOne = (item: string): DemoStockLink[] => [{ item, qty: 1 }];

export const FARDO_12 = { name: 'Fardo 12 un.', factor: 12 };
export const FARDO_6 = { name: 'Fardo 6 un.', factor: 6 };
export const CAIXA_24 = { name: 'Caixa 24 un.', factor: 24 };

const can = (flavor: string, costCents: number) => drinkItem(`${flavor} lata 350ml`, 48, 12, costCents, FARDO_12);
const bottle = (flavor: string, costCents: number) => drinkItem(`${flavor} 2L`, 12, 6, costCents, FARDO_6);
const longNeck = (brand: string, costCents: number) =>
  drinkItem(`Cerveja ${brand} long neck 330ml`, 24, 12, costCents, CAIXA_24);

/**
 * Stock of the industrialized drinks in `DRINKS` (natural juices are made to order and take none). Every demo menu
 * that lists `DRINKS` carries it.
 */
export const DRINKS_STOCK: DemoStockItem[] = [
  can('Coca-Cola', 350),
  can('Coca-Cola Zero', 350),
  can('Guaraná Antarctica', 290),
  can('Guaraná Zero', 290),
  can('Fanta Laranja', 290),
  can('Fanta Uva', 290),
  can('Sprite', 290),
  can('Soda Limonada', 290),
  bottle('Coca-Cola', 950),
  bottle('Coca-Cola Zero', 950),
  bottle('Guaraná Antarctica', 750),
  bottle('Fanta Laranja', 750),
  bottle('Sprite', 750),
  drinkItem('Água Mineral 500ml', 24, 12, 120, FARDO_12),
  drinkItem('Água com Gás 500ml', 24, 12, 160, FARDO_12),
  drinkItem('Chá Gelado 450ml', 12, 6, 350, FARDO_6),
  longNeck('Heineken', 560),
  longNeck('Stella Artois', 540),
  longNeck('Budweiser', 480),
  longNeck('Corona', 650)
];

/**
 * Drinks category shared by every demo menu.
 */
export const DRINKS: MenuImport['categories'][number] = {
  name: 'Bebidas',
  products: [
    {
      name: 'Refrigerante Lata 350ml',
      price_cents: 650,
      image: 'drinks/soda-can.webp',
      groups: [
        {
          name: 'Sabor',
          min: 1,
          max: 1,
          price_mode: PriceMode.Sum,
          options: [
            { name: 'Coca-Cola', price_delta_cents: 0, stock: takeOne('Coca-Cola lata 350ml') },
            { name: 'Coca-Cola Zero', price_delta_cents: 0, stock: takeOne('Coca-Cola Zero lata 350ml') },
            { name: 'Guaraná Antarctica', price_delta_cents: 0, stock: takeOne('Guaraná Antarctica lata 350ml') },
            { name: 'Guaraná Zero', price_delta_cents: 0, stock: takeOne('Guaraná Zero lata 350ml') },
            { name: 'Fanta Laranja', price_delta_cents: 0, stock: takeOne('Fanta Laranja lata 350ml') },
            { name: 'Fanta Uva', price_delta_cents: 0, stock: takeOne('Fanta Uva lata 350ml') },
            { name: 'Sprite', price_delta_cents: 0, stock: takeOne('Sprite lata 350ml') },
            { name: 'Soda Limonada', price_delta_cents: 0, stock: takeOne('Soda Limonada lata 350ml') }
          ]
        }
      ]
    },
    {
      name: 'Refrigerante 2L',
      price_cents: 1500,
      image: 'drinks/soda-2l.webp',
      groups: [
        {
          name: 'Sabor',
          min: 1,
          max: 1,
          price_mode: PriceMode.Sum,
          options: [
            { name: 'Coca-Cola', price_delta_cents: 200, stock: takeOne('Coca-Cola 2L') },
            { name: 'Coca-Cola Zero', price_delta_cents: 200, stock: takeOne('Coca-Cola Zero 2L') },
            { name: 'Guaraná Antarctica', price_delta_cents: 0, stock: takeOne('Guaraná Antarctica 2L') },
            { name: 'Fanta Laranja', price_delta_cents: 0, stock: takeOne('Fanta Laranja 2L') },
            { name: 'Sprite', price_delta_cents: 0, stock: takeOne('Sprite 2L') }
          ]
        }
      ]
    },
    {
      name: 'Suco Natural 500ml',
      price_cents: 1100,
      image: 'drinks/natural-juice.webp',
      groups: [
        {
          name: 'Fruta',
          min: 1,
          max: 1,
          price_mode: PriceMode.Sum,
          options: [
            { name: 'Laranja', price_delta_cents: 0 },
            { name: 'Limão', price_delta_cents: 0 },
            { name: 'Maracujá', price_delta_cents: 0 },
            { name: 'Abacaxi com Hortelã', price_delta_cents: 100 },
            { name: 'Morango', price_delta_cents: 200 },
            { name: 'Manga', price_delta_cents: 100 },
            { name: 'Acerola', price_delta_cents: 0 }
          ]
        },
        {
          name: 'Preparo',
          min: 0,
          max: 1,
          price_mode: PriceMode.Sum,
          options: [
            { name: 'Com leite', price_delta_cents: 200 },
            { name: 'Sem açúcar', price_delta_cents: 0 }
          ]
        }
      ]
    },
    {
      name: 'Água Mineral 500ml',
      price_cents: 400,
      image: 'drinks/water.webp',
      stock: takeOne('Água Mineral 500ml')
    },
    {
      name: 'Água com Gás 500ml',
      price_cents: 450,
      image: 'drinks/sparkling-water.webp',
      stock: takeOne('Água com Gás 500ml')
    },
    {
      name: 'Chá Gelado 450ml',
      description: 'Pêssego ou limão.',
      price_cents: 700,
      image: 'drinks/iced-tea.webp',
      stock: takeOne('Chá Gelado 450ml')
    },
    {
      name: 'Cerveja Long Neck',
      price_cents: 1000,
      image: 'drinks/beer-long-neck.webp',
      groups: [
        {
          name: 'Marca',
          min: 1,
          max: 1,
          price_mode: PriceMode.Sum,
          options: [
            { name: 'Heineken', price_delta_cents: 200, stock: takeOne('Cerveja Heineken long neck 330ml') },
            { name: 'Stella Artois', price_delta_cents: 200, stock: takeOne('Cerveja Stella Artois long neck 330ml') },
            { name: 'Budweiser', price_delta_cents: 0, stock: takeOne('Cerveja Budweiser long neck 330ml') },
            { name: 'Corona', price_delta_cents: 300, stock: takeOne('Cerveja Corona long neck 330ml') }
          ]
        }
      ]
    }
  ]
};
