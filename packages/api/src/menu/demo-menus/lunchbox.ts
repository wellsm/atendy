import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS, DRINKS_STOCK } from './drinks';

const proteins = (max: number) => ({
  name: max === 1 ? 'Mistura' : 'Misturas',
  min: 1,
  max,
  price_mode: PriceMode.Max,
  options: [
    { name: 'Frango grelhado', price_delta_cents: 0 },
    { name: 'Frango assado', price_delta_cents: 0 },
    { name: 'Frango à parmegiana', price_delta_cents: 400 },
    { name: 'Bife acebolado', price_delta_cents: 300 },
    { name: 'Bife à parmegiana', price_delta_cents: 600 },
    { name: 'Carne de panela', price_delta_cents: 300 },
    { name: 'Costela assada', price_delta_cents: 700 },
    { name: 'Linguiça toscana', price_delta_cents: 0 },
    { name: 'Calabresa acebolada', price_delta_cents: 0 },
    { name: 'Lombo assado', price_delta_cents: 300 },
    { name: 'Filé de tilápia', price_delta_cents: 600 },
    { name: 'Omelete', price_delta_cents: 0 },
    { name: 'Strogonoff de frango', price_delta_cents: 200 },
    { name: 'Feijoada (sextas)', price_delta_cents: 500 }
  ]
});

const sides = {
  name: 'Acompanhamentos',
  min: 1,
  max: 4,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Arroz branco', price_delta_cents: 0 },
    { name: 'Arroz integral', price_delta_cents: 0 },
    { name: 'Feijão carioca', price_delta_cents: 0 },
    { name: 'Feijão preto', price_delta_cents: 0 },
    { name: 'Macarrão alho e óleo', price_delta_cents: 0 },
    { name: 'Farofa', price_delta_cents: 0 },
    { name: 'Purê de batata', price_delta_cents: 0 },
    { name: 'Batata frita', price_delta_cents: 300 },
    { name: 'Legumes no vapor', price_delta_cents: 0 },
    { name: 'Salada verde', price_delta_cents: 0 },
    { name: 'Maionese de batata', price_delta_cents: 0 },
    { name: 'Vinagrete', price_delta_cents: 0 }
  ]
};

const extras = {
  name: 'Extras',
  min: 0,
  max: 3,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Ovo frito', price_delta_cents: 300 },
    { name: 'Mistura extra', price_delta_cents: 900 },
    { name: 'Talheres descartáveis', price_delta_cents: 0 }
  ]
};

export const LUNCHBOX_MENU: MenuImport = {
  stock: DRINKS_STOCK,
  categories: [
    {
      name: 'Marmitas',
      products: [
        {
          name: 'Marmita P',
          description: '500g. 1 mistura e até 4 acompanhamentos.',
          price_cents: 1990,
          image: 'lunchbox/small.webp',
          groups: [proteins(1), sides, extras]
        },
        {
          name: 'Marmita M',
          description: '750g. Até 2 misturas (cobra a mais cara) e 4 acompanhamentos.',
          price_cents: 2490,
          image: 'lunchbox/medium.webp',
          groups: [proteins(2), sides, extras]
        },
        {
          name: 'Marmita G',
          description: '1kg. Até 2 misturas (cobra a mais cara) e 4 acompanhamentos.',
          price_cents: 2990,
          image: 'lunchbox/large.webp',
          groups: [proteins(2), sides, extras]
        },
        {
          name: 'Marmita Fit',
          description: 'Arroz integral, legumes no vapor, salada e proteína grelhada.',
          price_cents: 0,
          image: 'lunchbox/fit.webp',
          groups: [
            {
              name: 'Proteína',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Frango grelhado', price_delta_cents: 2490 },
                { name: 'Patinho moído', price_delta_cents: 2690 },
                { name: 'Tilápia grelhada', price_delta_cents: 2990 },
                { name: 'Omelete de claras', price_delta_cents: 2290 }
              ]
            },
            {
              name: 'Carboidrato',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Arroz integral', price_delta_cents: 0 },
                { name: 'Batata-doce', price_delta_cents: 0 },
                { name: 'Mandioquinha', price_delta_cents: 200 }
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Pratos do Dia',
      products: [
        {
          name: 'Feijoada Completa',
          description: 'Arroz, couve, farofa, torresmo e laranja. Sextas e sábados.',
          price_cents: 3490,
          image: 'lunchbox/feijoada.webp'
        },
        {
          name: 'Strogonoff',
          description: 'Arroz, batata palha e salada.',
          price_cents: 0,
          image: 'lunchbox/stroganoff.webp',
          groups: [
            {
              name: 'Tipo',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Frango', price_delta_cents: 2690 },
                { name: 'Carne', price_delta_cents: 2990 }
              ]
            }
          ]
        },
        {
          name: 'Parmegiana com Fritas',
          description: 'Arroz, fritas e parmegiana gratinada.',
          price_cents: 0,
          image: 'lunchbox/parmigiana.webp',
          groups: [
            {
              name: 'Tipo',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Frango', price_delta_cents: 2990 },
                { name: 'Carne', price_delta_cents: 3390 }
              ]
            }
          ]
        },
        {
          name: 'Escondidinho',
          price_cents: 0,
          image: 'lunchbox/escondidinho.webp',
          groups: [
            {
              name: 'Recheio',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Carne seca com mandioca', price_delta_cents: 2990 },
                { name: 'Frango com batata', price_delta_cents: 2490 }
              ]
            }
          ]
        },
        {
          name: 'Salada Completa',
          description: 'Folhas, tomate, cenoura, pepino, ovo e proteína grelhada.',
          price_cents: 2390,
          image: 'lunchbox/salad.webp'
        }
      ]
    },
    {
      name: 'Sobremesas',
      products: [
        { name: 'Pudim', price_cents: 790, image: 'lunchbox/flan.webp' },
        { name: 'Doce de Abóbora', price_cents: 590, image: 'lunchbox/pumpkin-sweet.webp' },
        { name: 'Arroz Doce', price_cents: 690, image: 'lunchbox/rice-pudding.webp' }
      ]
    },
    DRINKS
  ]
};
