import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS } from './drinks';

const freeToppings = {
  name: 'Complementos grátis',
  min: 0,
  max: 5,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Granola', price_delta_cents: 0 },
    { name: 'Banana', price_delta_cents: 0 },
    { name: 'Leite em pó', price_delta_cents: 0 },
    { name: 'Leite condensado', price_delta_cents: 0 },
    { name: 'Paçoca', price_delta_cents: 0 },
    { name: 'Amendoim', price_delta_cents: 0 },
    { name: 'Granulado', price_delta_cents: 0 },
    { name: 'Sucrilhos', price_delta_cents: 0 },
    { name: 'Mel', price_delta_cents: 0 },
    { name: 'Calda de chocolate', price_delta_cents: 0 },
    { name: 'Calda de morango', price_delta_cents: 0 },
    { name: 'Coco ralado', price_delta_cents: 0 }
  ]
};

const paidToppings = {
  name: 'Adicionais',
  min: 0,
  max: 6,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Morango', price_delta_cents: 400 },
    { name: 'Kiwi', price_delta_cents: 400 },
    { name: 'Manga', price_delta_cents: 300 },
    { name: 'Nutella', price_delta_cents: 600 },
    { name: 'Creme de ninho', price_delta_cents: 500 },
    { name: 'Creme de cupuaçu', price_delta_cents: 500 },
    { name: 'Bis picado', price_delta_cents: 400 },
    { name: 'Ovomaltine', price_delta_cents: 400 },
    { name: 'Kit Kat', price_delta_cents: 500 },
    { name: 'Confete', price_delta_cents: 400 },
    { name: 'Marshmallow', price_delta_cents: 400 },
    { name: 'Bombom picado', price_delta_cents: 500 }
  ]
};

const base = {
  name: 'Base',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Açaí tradicional', price_delta_cents: 0 },
    { name: 'Açaí zero açúcar', price_delta_cents: 200 },
    { name: 'Açaí com banana batido', price_delta_cents: 0 },
    { name: 'Meio açaí, meio cupuaçu', price_delta_cents: 200 }
  ]
};

const cup = (name: string, price: number, image: string) => ({
  name,
  price_cents: price,
  image: `acai/${image}.webp`,
  groups: [base, freeToppings, paidToppings]
});

export const ACAI_MENU: MenuImport = {
  categories: [
    {
      name: 'Monte seu Açaí',
      products: [
        cup('Açaí 300ml', 1490, 'cup-300'),
        cup('Açaí 500ml', 1990, 'cup-500'),
        cup('Açaí 700ml', 2590, 'cup-700'),
        cup('Açaí 1 Litro', 3490, 'cup-1l'),
        cup('Barca de Açaí', 5990, 'boat')
      ]
    },
    {
      name: 'Açaís Prontos',
      products: [
        {
          name: 'Açaí Tropical 500ml',
          description: 'Morango, kiwi, manga, granola e mel.',
          price_cents: 2690,
          image: 'acai/tropical.webp'
        },
        {
          name: 'Açaí Trufado 500ml',
          description: 'Creme de ninho, Nutella, morango e Kit Kat.',
          price_cents: 3190,
          image: 'acai/truffle.webp'
        },
        {
          name: 'Açaí Fit 500ml',
          description: 'Zero açúcar, banana, granola sem açúcar e pasta de amendoim.',
          price_cents: 2690,
          image: 'acai/fit.webp'
        },
        {
          name: 'Açaí Kids 300ml',
          description: 'Confete, granulado, marshmallow e leite condensado.',
          price_cents: 1890,
          image: 'acai/kids.webp'
        }
      ]
    },
    {
      name: 'Cremes e Sorvetes',
      products: [
        {
          name: 'Creme de Cupuaçu 500ml',
          price_cents: 2190,
          image: 'acai/cupuacu.webp',
          groups: [freeToppings, paidToppings]
        },
        {
          name: 'Sorvete no Copo',
          description: '2 bolas.',
          price_cents: 1490,
          image: 'acai/ice-cream.webp',
          groups: [
            {
              name: 'Sabores',
              min: 1,
              max: 2,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Creme', price_delta_cents: 0 },
                { name: 'Chocolate', price_delta_cents: 0 },
                { name: 'Morango', price_delta_cents: 0 },
                { name: 'Flocos', price_delta_cents: 0 },
                { name: 'Ninho trufado', price_delta_cents: 200 },
                { name: 'Pistache', price_delta_cents: 400 }
              ]
            },
            paidToppings
          ]
        },
        {
          name: 'Milkshake de Açaí 500ml',
          price_cents: 2190,
          image: 'acai/acai-shake.webp'
        },
        {
          name: 'Smoothie 400ml',
          price_cents: 1690,
          image: 'acai/smoothie.webp',
          groups: [
            {
              name: 'Sabor',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Morango com banana', price_delta_cents: 0 },
                { name: 'Manga com maracujá', price_delta_cents: 0 },
                { name: 'Frutas vermelhas', price_delta_cents: 200 }
              ]
            }
          ]
        }
      ]
    },
    DRINKS
  ]
};
