import type { MenuImport } from '../repository';

import { PriceMode } from '../types';

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
            { name: 'Coca-Cola', price_delta_cents: 0 },
            { name: 'Coca-Cola Zero', price_delta_cents: 0 },
            { name: 'Guaraná Antarctica', price_delta_cents: 0 },
            { name: 'Guaraná Zero', price_delta_cents: 0 },
            { name: 'Fanta Laranja', price_delta_cents: 0 },
            { name: 'Fanta Uva', price_delta_cents: 0 },
            { name: 'Sprite', price_delta_cents: 0 },
            { name: 'Soda Limonada', price_delta_cents: 0 }
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
            { name: 'Coca-Cola', price_delta_cents: 200 },
            { name: 'Coca-Cola Zero', price_delta_cents: 200 },
            { name: 'Guaraná Antarctica', price_delta_cents: 0 },
            { name: 'Fanta Laranja', price_delta_cents: 0 },
            { name: 'Sprite', price_delta_cents: 0 }
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
    { name: 'Água Mineral 500ml', price_cents: 400, image: 'drinks/water.webp' },
    { name: 'Água com Gás 500ml', price_cents: 450, image: 'drinks/sparkling-water.webp' },
    { name: 'Chá Gelado 450ml', description: 'Pêssego ou limão.', price_cents: 700, image: 'drinks/iced-tea.webp' },
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
            { name: 'Heineken', price_delta_cents: 200 },
            { name: 'Stella Artois', price_delta_cents: 200 },
            { name: 'Budweiser', price_delta_cents: 0 },
            { name: 'Corona', price_delta_cents: 300 }
          ]
        }
      ]
    }
  ]
};
