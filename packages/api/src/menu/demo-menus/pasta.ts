import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS, DRINKS_STOCK } from './drinks';

const pastaTypes = {
  name: 'Massa',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Espaguete', price_delta_cents: 0 },
    { name: 'Penne', price_delta_cents: 0 },
    { name: 'Talharim', price_delta_cents: 0 },
    { name: 'Fusilli', price_delta_cents: 0 },
    { name: 'Fettuccine', price_delta_cents: 0 },
    { name: 'Nhoque de batata', price_delta_cents: 500 },
    { name: 'Integral', price_delta_cents: 300 },
    { name: 'Sem glúten', price_delta_cents: 800 }
  ]
};

const extras = {
  name: 'Adicionais',
  min: 0,
  max: 5,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Frango grelhado', price_delta_cents: 800 },
    { name: 'Bacon', price_delta_cents: 700 },
    { name: 'Calabresa', price_delta_cents: 600 },
    { name: 'Camarão', price_delta_cents: 1800 },
    { name: 'Almôndegas (3 un.)', price_delta_cents: 1200 },
    { name: 'Champignon', price_delta_cents: 600 },
    { name: 'Brócolis', price_delta_cents: 500 },
    { name: 'Parmesão extra', price_delta_cents: 500 },
    { name: 'Gratinar com mussarela', price_delta_cents: 800 }
  ]
};

const size = {
  name: 'Tamanho',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Individual', price_delta_cents: 0 },
    { name: 'Para dois', price_delta_cents: 2500 }
  ]
};

export const PASTA_MENU: MenuImport = {
  stock: DRINKS_STOCK,
  categories: [
    {
      name: 'Monte sua Massa',
      products: [
        {
          name: 'Massa com Molho',
          description: 'Escolha a massa e o molho (molhos com o preço já incluso).',
          price_cents: 0,
          image: 'pasta/build-your-own.webp',
          groups: [
            pastaTypes,
            {
              name: 'Molho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Sugo', price_delta_cents: 3290 },
                { name: 'Bolonhesa', price_delta_cents: 3790 },
                { name: 'Branco', price_delta_cents: 3590 },
                { name: 'Rosé', price_delta_cents: 3690 },
                { name: 'Quatro queijos', price_delta_cents: 4190 },
                { name: 'Alho e óleo', price_delta_cents: 3190 },
                { name: 'Pesto de manjericão', price_delta_cents: 3990 },
                { name: 'Funghi', price_delta_cents: 4490 },
                { name: 'Carbonara', price_delta_cents: 4290 },
                { name: 'Puttanesca', price_delta_cents: 3890 }
              ]
            },
            size,
            extras
          ]
        }
      ]
    },
    {
      name: 'Massas da Casa',
      products: [
        {
          name: 'Lasanha à Bolonhesa',
          description: 'Camadas de massa, bolonhesa, presunto, mussarela e bechamel.',
          price_cents: 4290,
          image: 'pasta/lasagna-bolognese.webp',
          groups: [size]
        },
        {
          name: 'Lasanha de Frango',
          description: 'Frango desfiado, catupiry, milho e molho branco.',
          price_cents: 4190,
          image: 'pasta/chicken-lasagna.webp',
          groups: [size]
        },
        {
          name: 'Lasanha Quatro Queijos',
          description: 'Mussarela, parmesão, provolone e gorgonzola.',
          price_cents: 4390,
          image: 'pasta/four-cheese-lasagna.webp',
          groups: [size]
        },
        {
          name: 'Canelone de Ricota e Espinafre',
          description: 'Ao molho sugo gratinado.',
          price_cents: 3990,
          image: 'pasta/cannelloni.webp',
          groups: [size]
        },
        {
          name: 'Nhoque ao Sugo com Almôndegas',
          price_cents: 4290,
          image: 'pasta/gnocchi-meatballs.webp',
          groups: [size, extras]
        },
        {
          name: 'Ravioli de Queijo',
          description: 'Recheio de queijos ao molho escolhido.',
          price_cents: 0,
          image: 'pasta/cheese-ravioli.webp',
          groups: [
            {
              name: 'Molho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Sugo', price_delta_cents: 4190 },
                { name: 'Manteiga e sálvia', price_delta_cents: 4390 },
                { name: 'Quatro queijos', price_delta_cents: 4690 }
              ]
            },
            size
          ]
        },
        {
          name: 'Fettuccine Alfredo com Frango',
          price_cents: 4490,
          image: 'pasta/fettuccine-alfredo.webp',
          groups: [size, extras]
        },
        {
          name: 'Espaguete com Camarão',
          description: 'Camarão salteado no alho, tomate cereja e manjericão.',
          price_cents: 5990,
          image: 'pasta/shrimp-spaghetti.webp',
          groups: [size]
        },
        {
          name: 'Risoto de Funghi',
          description: 'Arroz arbóreo, funghi secchi e parmesão.',
          price_cents: 4990,
          image: 'pasta/mushroom-risotto.webp'
        },
        {
          name: 'Risoto de Camarão',
          price_cents: 5890,
          image: 'pasta/shrimp-risotto.webp'
        }
      ]
    },
    {
      name: 'Entradas',
      products: [
        {
          name: 'Bruschetta',
          description: '4 unidades de tomate e manjericão.',
          price_cents: 2290,
          image: 'pasta/bruschetta.webp'
        },
        { name: 'Pão de Alho', description: '4 unidades.', price_cents: 1690, image: 'pasta/garlic-bread.webp' },
        {
          name: 'Salada Caesar',
          price_cents: 2690,
          image: 'pasta/caesar-salad.webp',
          groups: [
            {
              name: 'Adicional',
              min: 0,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [{ name: 'Frango grelhado', price_delta_cents: 800 }]
            }
          ]
        },
        { name: 'Polenta Frita', description: 'Com parmesão.', price_cents: 1990, image: 'pasta/fried-polenta.webp' }
      ]
    },
    {
      name: 'Sobremesas',
      products: [
        { name: 'Tiramisù', price_cents: 2190, image: 'pasta/tiramisu.webp' },
        { name: 'Panna Cotta com Frutas Vermelhas', price_cents: 1890, image: 'pasta/panna-cotta.webp' },
        {
          name: 'Petit Gâteau',
          description: 'Com sorvete de creme.',
          price_cents: 2290,
          image: 'pasta/petit-gateau.webp'
        }
      ]
    },
    DRINKS
  ]
};
