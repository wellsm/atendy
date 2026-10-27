import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS } from './drinks';

/**
 * Full pizzeria. Pizza prices live in the flavors (base price 0), so half-and-half charges the most
 * expensive flavor (`price_mode: max`). The size only changes the flavor list prices.
 */
const flavors = (factor: number) =>
  [
    { name: 'Mussarela', price_delta_cents: 4590 },
    { name: 'Calabresa', price_delta_cents: 4790 },
    { name: 'Margherita', price_delta_cents: 4890 },
    { name: 'Napolitana', price_delta_cents: 4890 },
    { name: 'Milho com Bacon', price_delta_cents: 4990 },
    { name: 'Toscana', price_delta_cents: 4990 },
    { name: 'Atum', price_delta_cents: 5190 },
    { name: 'Portuguesa', price_delta_cents: 5290 },
    { name: 'Frango com Catupiry', price_delta_cents: 5290 },
    { name: 'Baiana', price_delta_cents: 5290 },
    { name: 'Moda da Casa', price_delta_cents: 5490 },
    { name: 'Quatro Queijos', price_delta_cents: 5490 },
    { name: 'Lombo com Catupiry', price_delta_cents: 5590 },
    { name: 'Bacon com Cheddar', price_delta_cents: 5590 },
    { name: 'Pepperoni', price_delta_cents: 5790 },
    { name: 'Palmito', price_delta_cents: 5790 },
    { name: 'Carne Seca com Catupiry', price_delta_cents: 6290 },
    { name: 'Camarão', price_delta_cents: 6990 }
  ].map(({ name, price_delta_cents }) => ({
    name,
    price_delta_cents: Math.round((price_delta_cents * factor) / 10) * 10
  }));

const sweetFlavors = (factor: number) =>
  [
    { name: 'Chocolate', price_delta_cents: 4590 },
    { name: 'Brigadeiro', price_delta_cents: 4790 },
    { name: 'Prestígio', price_delta_cents: 4790 },
    { name: 'Romeu e Julieta', price_delta_cents: 4790 },
    { name: 'Banana com Canela', price_delta_cents: 4590 },
    { name: 'Chocolate com Morango', price_delta_cents: 5290 },
    { name: 'Nutella com Morango', price_delta_cents: 5990 }
  ].map(({ name, price_delta_cents }) => ({
    name,
    price_delta_cents: Math.round((price_delta_cents * factor) / 10) * 10
  }));

const crust = (price: number) => ({
  name: 'Borda',
  min: 0,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Catupiry', price_delta_cents: price },
    { name: 'Cheddar', price_delta_cents: price },
    { name: 'Cream Cheese', price_delta_cents: price },
    { name: 'Chocolate', price_delta_cents: price + 200 }
  ]
});

const pizzaExtras = {
  name: 'Adicionais',
  min: 0,
  max: 4,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Bacon', price_delta_cents: 600 },
    { name: 'Catupiry extra', price_delta_cents: 600 },
    { name: 'Cheddar extra', price_delta_cents: 600 },
    { name: 'Calabresa extra', price_delta_cents: 500 },
    { name: 'Azeitona', price_delta_cents: 300 },
    { name: 'Cebola', price_delta_cents: 200 },
    { name: 'Ovo', price_delta_cents: 300 }
  ]
};

export const PIZZERIA_MENU: MenuImport = {
  categories: [
    {
      name: 'Pizzas Salgadas',
      products: [
        {
          name: 'Pizza Família',
          description: '12 fatias. Até 3 sabores (cobra o sabor mais caro).',
          price_cents: 0,
          image: 'pizzeria/pizza-family.webp',
          groups: [
            { name: 'Sabores', min: 1, max: 3, price_mode: PriceMode.Max, options: flavors(1.3) },
            crust(1200),
            pizzaExtras
          ]
        },
        {
          name: 'Pizza Grande',
          description: '8 fatias. Até 2 sabores (meio a meio cobra o sabor mais caro).',
          price_cents: 0,
          image: 'pizzeria/pizza-large.webp',
          groups: [
            { name: 'Sabores', min: 1, max: 2, price_mode: PriceMode.Max, options: flavors(1) },
            crust(1000),
            pizzaExtras
          ]
        },
        {
          name: 'Pizza Média',
          description: '6 fatias. Até 2 sabores.',
          price_cents: 0,
          image: 'pizzeria/pizza-medium.webp',
          groups: [
            { name: 'Sabores', min: 1, max: 2, price_mode: PriceMode.Max, options: flavors(0.8) },
            crust(800),
            pizzaExtras
          ]
        },
        {
          name: 'Pizza Broto',
          description: '4 fatias. 1 sabor.',
          price_cents: 0,
          image: 'pizzeria/pizza-small.webp',
          groups: [{ name: 'Sabor', min: 1, max: 1, price_mode: PriceMode.Sum, options: flavors(0.6) }, crust(600)]
        }
      ]
    },
    {
      name: 'Pizzas Doces',
      products: [
        {
          name: 'Pizza Doce Grande',
          description: '8 fatias. Até 2 sabores.',
          price_cents: 0,
          image: 'pizzeria/sweet-pizza-large.webp',
          groups: [{ name: 'Sabores', min: 1, max: 2, price_mode: PriceMode.Max, options: sweetFlavors(1) }]
        },
        {
          name: 'Pizza Doce Broto',
          description: '4 fatias. 1 sabor.',
          price_cents: 0,
          image: 'pizzeria/sweet-pizza-small.webp',
          groups: [{ name: 'Sabor', min: 1, max: 1, price_mode: PriceMode.Sum, options: sweetFlavors(0.6) }]
        }
      ]
    },
    {
      name: 'Esfihas',
      products: [
        {
          name: 'Esfiha Aberta',
          description: 'Unidade.',
          price_cents: 0,
          image: 'pizzeria/open-esfiha.webp',
          groups: [
            {
              name: 'Sabor',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Carne', price_delta_cents: 650 },
                { name: 'Queijo', price_delta_cents: 650 },
                { name: 'Calabresa', price_delta_cents: 650 },
                { name: 'Frango com Catupiry', price_delta_cents: 750 },
                { name: 'Escarola', price_delta_cents: 700 },
                { name: 'Chocolate', price_delta_cents: 800 }
              ]
            }
          ]
        },
        {
          name: 'Combo 10 Esfihas',
          description: '10 esfihas abertas de carne ou queijo, pode misturar.',
          price_cents: 5490,
          image: 'pizzeria/esfiha-combo.webp',
          groups: [
            {
              name: 'Mistura',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: '10 de carne', price_delta_cents: 0 },
                { name: '10 de queijo', price_delta_cents: 0 },
                { name: '5 de carne e 5 de queijo', price_delta_cents: 0 }
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Entradas',
      products: [
        {
          name: 'Calzone',
          description: 'Pizza fechada recheada.',
          price_cents: 0,
          image: 'pizzeria/calzone.webp',
          groups: [
            {
              name: 'Recheio',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Calabresa com Queijo', price_delta_cents: 3990 },
                { name: 'Frango com Catupiry', price_delta_cents: 4290 },
                { name: 'Presunto e Queijo', price_delta_cents: 3990 }
              ]
            }
          ]
        },
        {
          name: 'Pão de Alho',
          description: '4 unidades.',
          price_cents: 1890,
          image: 'pizzeria/garlic-bread.webp'
        },
        {
          name: 'Batata Frita',
          price_cents: 2290,
          image: 'pizzeria/fries.webp',
          groups: [
            {
              name: 'Cobertura',
              min: 0,
              max: 2,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Cheddar', price_delta_cents: 600 },
                { name: 'Bacon', price_delta_cents: 600 }
              ]
            }
          ]
        }
      ]
    },
    DRINKS
  ]
};
