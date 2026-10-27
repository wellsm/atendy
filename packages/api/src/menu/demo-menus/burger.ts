import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS } from './drinks';

const doneness = {
  name: 'Ponto da carne',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Mal passado', price_delta_cents: 0 },
    { name: 'Ao ponto', price_delta_cents: 0 },
    { name: 'Bem passado', price_delta_cents: 0 }
  ]
};

const extras = {
  name: 'Adicionais',
  min: 0,
  max: 6,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Blend extra 150g', price_delta_cents: 1200 },
    { name: 'Bacon', price_delta_cents: 500 },
    { name: 'Cheddar', price_delta_cents: 400 },
    { name: 'Queijo prato', price_delta_cents: 400 },
    { name: 'Ovo', price_delta_cents: 300 },
    { name: 'Cebola caramelizada', price_delta_cents: 400 },
    { name: 'Picles', price_delta_cents: 300 },
    { name: 'Jalapeño', price_delta_cents: 400 },
    { name: 'Onion rings (3 un.)', price_delta_cents: 600 }
  ]
};

const sauces = {
  name: 'Molho extra',
  min: 0,
  max: 3,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Maionese da casa', price_delta_cents: 300 },
    { name: 'Barbecue', price_delta_cents: 300 },
    { name: 'Cheddar cremoso', price_delta_cents: 400 },
    { name: 'Maionese de alho', price_delta_cents: 300 },
    { name: 'Mostarda e mel', price_delta_cents: 300 },
    { name: 'Sriracha', price_delta_cents: 300 }
  ]
};

const combo = {
  name: 'Transformar em combo',
  min: 0,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Batata média + refri lata', price_delta_cents: 1600 },
    { name: 'Batata grande + refri lata', price_delta_cents: 1900 },
    { name: 'Onion rings + refri lata', price_delta_cents: 1900 }
  ]
};

const burger = (name: string, description: string, price: number, image: string) => ({
  name,
  description,
  price_cents: price,
  image: `burger/${image}.webp`,
  groups: [doneness, extras, sauces, combo]
});

export const BURGER_MENU: MenuImport = {
  categories: [
    {
      name: 'Burgers Artesanais',
      products: [
        burger('Classic', 'Pão brioche, blend 150g, queijo prato, alface, tomate e maionese da casa.', 2890, 'classic'),
        burger(
          'Cheese Bacon',
          'Pão brioche, blend 150g, cheddar, bacon crocante e maionese da casa.',
          3290,
          'cheese-bacon'
        ),
        burger('Duplo Smash', 'Dois smash 90g, cheddar duplo, cebola e picles no pão de batata.', 3190, 'double-smash'),
        burger(
          'Triplo Smash',
          'Três smash 90g, cheddar triplo, cebola e picles no pão de batata.',
          3890,
          'triple-smash'
        ),
        burger('Barbecue', 'Blend 150g, cheddar, bacon, onion rings e molho barbecue.', 3590, 'barbecue'),
        burger(
          'Cebola Caramelizada',
          'Blend 150g, queijo gruyère, cebola caramelizada e rúcula.',
          3690,
          'caramelized-onion'
        ),
        burger('Costela', 'Blend de costela 180g, queijo coalho, cebola roxa e maionese de alho.', 3990, 'short-rib'),
        burger('Picanha', 'Blend de picanha 180g, mussarela, vinagrete e farofa de bacon.', 4290, 'picanha'),
        burger(
          'Monstro',
          'Dois blends 150g, cheddar, bacon, ovo, cebola caramelizada e molho especial.',
          4790,
          'monster'
        ),
        burger('Jalapeño', 'Blend 150g, pepper jack, jalapeño, bacon e sriracha.', 3590, 'jalapeno'),
        burger('Gorgonzola', 'Blend 150g, gorgonzola, cebola caramelizada e geleia de pimenta.', 3790, 'gorgonzola')
      ]
    },
    {
      name: 'Frango e Vegetarianos',
      products: [
        {
          name: 'Crispy Chicken',
          description: 'Sobrecoxa empanada crocante, alface, picles e maionese de alho.',
          price_cents: 3190,
          image: 'burger/crispy-chicken.webp',
          groups: [extras, sauces, combo]
        },
        {
          name: 'Veggie',
          description: 'Burger de grão-de-bico, queijo prato, tomate, alface e maionese verde.',
          price_cents: 3090,
          image: 'burger/veggie.webp',
          groups: [extras, sauces, combo]
        },
        {
          name: 'Smash Kids',
          description: 'Um smash 90g, cheddar e ketchup. Acompanha batata pequena.',
          price_cents: 2290,
          image: 'burger/kids.webp'
        }
      ]
    },
    {
      name: 'Acompanhamentos',
      products: [
        {
          name: 'Batata Frita',
          price_cents: 0,
          image: 'burger/fries.webp',
          groups: [
            {
              name: 'Tamanho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Média', price_delta_cents: 1490 },
                { name: 'Grande', price_delta_cents: 1990 }
              ]
            },
            {
              name: 'Cobertura',
              min: 0,
              max: 2,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Cheddar e bacon', price_delta_cents: 900 },
                { name: 'Parmesão e alecrim', price_delta_cents: 600 }
              ]
            }
          ]
        },
        {
          name: 'Batata Rústica',
          description: 'Com páprica e maionese de alho.',
          price_cents: 2190,
          image: 'burger/rustic-potatoes.webp'
        },
        {
          name: 'Onion Rings',
          description: '10 unidades com molho barbecue.',
          price_cents: 2190,
          image: 'burger/onion-rings.webp'
        },
        {
          name: 'Nuggets',
          description: '10 unidades com molho à escolha.',
          price_cents: 2290,
          image: 'burger/nuggets.webp'
        },
        {
          name: 'Mandioca Frita',
          description: 'Com maionese da casa.',
          price_cents: 1990,
          image: 'burger/fried-cassava.webp'
        }
      ]
    },
    {
      name: 'Sobremesas e Shakes',
      products: [
        {
          name: 'Milkshake 500ml',
          price_cents: 0,
          image: 'burger/milkshake.webp',
          groups: [
            {
              name: 'Sabor',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Chocolate', price_delta_cents: 2190 },
                { name: 'Morango', price_delta_cents: 2190 },
                { name: 'Baunilha', price_delta_cents: 2190 },
                { name: 'Ovomaltine', price_delta_cents: 2490 },
                { name: 'Nutella', price_delta_cents: 2690 },
                { name: 'Oreo', price_delta_cents: 2490 }
              ]
            }
          ]
        },
        { name: 'Brownie com Sorvete', price_cents: 1890, image: 'burger/brownie.webp' },
        {
          name: 'Cookie Recheado',
          description: 'Gotas de chocolate e recheio de Nutella.',
          price_cents: 1090,
          image: 'burger/cookie.webp'
        }
      ]
    },
    DRINKS
  ]
};
