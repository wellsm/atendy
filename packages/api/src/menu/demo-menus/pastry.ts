import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS, DRINKS_STOCK } from './drinks';

/**
 * Pastel shop. Flavor prices live in the options (base price 0); two flavors charge the most expensive.
 */
const savoryFlavors = [
  { name: 'Carne', price_delta_cents: 1290 },
  { name: 'Queijo', price_delta_cents: 1290 },
  { name: 'Pizza (presunto, queijo, tomate e orégano)', price_delta_cents: 1390 },
  { name: 'Frango', price_delta_cents: 1290 },
  { name: 'Frango com Catupiry', price_delta_cents: 1490 },
  { name: 'Palmito', price_delta_cents: 1590 },
  { name: 'Calabresa com Queijo', price_delta_cents: 1490 },
  { name: 'Carne com Queijo', price_delta_cents: 1490 },
  { name: 'Carne com Ovo', price_delta_cents: 1490 },
  { name: 'Bauru', price_delta_cents: 1490 },
  { name: 'Milho com Catupiry', price_delta_cents: 1390 },
  { name: 'Brócolis com Queijo', price_delta_cents: 1390 },
  { name: 'Bacalhau', price_delta_cents: 2190 },
  { name: 'Camarão com Catupiry', price_delta_cents: 2290 },
  { name: 'Carne Seca com Abóbora', price_delta_cents: 1990 },
  { name: 'Costela', price_delta_cents: 1890 }
];

const sweetFlavors = [
  { name: 'Chocolate', price_delta_cents: 1290 },
  { name: 'Banana com Canela', price_delta_cents: 1190 },
  { name: 'Romeu e Julieta', price_delta_cents: 1290 },
  { name: 'Prestígio', price_delta_cents: 1390 },
  { name: 'Doce de Leite', price_delta_cents: 1290 },
  { name: 'Nutella com Morango', price_delta_cents: 1790 }
];

const extras = {
  name: 'Adicionais',
  min: 0,
  max: 4,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Catupiry', price_delta_cents: 300 },
    { name: 'Cheddar', price_delta_cents: 300 },
    { name: 'Ovo', price_delta_cents: 250 },
    { name: 'Bacon', price_delta_cents: 400 },
    { name: 'Azeitona', price_delta_cents: 200 },
    { name: 'Milho', price_delta_cents: 200 }
  ]
};

export const PASTRY_MENU: MenuImport = {
  stock: DRINKS_STOCK,
  categories: [
    {
      name: 'Pastéis Salgados',
      products: [
        {
          name: 'Pastel Tradicional',
          description: 'Pastel de feira, 1 sabor.',
          price_cents: 0,
          image: 'pastry/traditional.webp',
          groups: [{ name: 'Sabor', min: 1, max: 1, price_mode: PriceMode.Sum, options: savoryFlavors }, extras]
        },
        {
          name: 'Pastel Gigante',
          description: '2x o recheio, até 2 sabores (cobra o mais caro + R$ 8).',
          price_cents: 800,
          image: 'pastry/giant.webp',
          groups: [{ name: 'Sabores', min: 1, max: 2, price_mode: PriceMode.Max, options: savoryFlavors }, extras]
        },
        {
          name: 'Mini Pastéis',
          description: 'Porção com 12 unidades, até 3 sabores.',
          price_cents: 2990,
          image: 'pastry/mini.webp',
          groups: [
            {
              name: 'Sabores',
              min: 1,
              max: 3,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Carne', price_delta_cents: 0 },
                { name: 'Queijo', price_delta_cents: 0 },
                { name: 'Pizza', price_delta_cents: 0 },
                { name: 'Frango', price_delta_cents: 0 }
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Pastéis Doces',
      products: [
        {
          name: 'Pastel Doce',
          price_cents: 0,
          image: 'pastry/sweet.webp',
          groups: [
            { name: 'Sabor', min: 1, max: 1, price_mode: PriceMode.Sum, options: sweetFlavors },
            {
              name: 'Cobertura',
              min: 0,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Açúcar e canela', price_delta_cents: 0 },
                { name: 'Leite condensado', price_delta_cents: 200 }
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'Combos',
      products: [
        {
          name: 'Combo Feira',
          description: '1 pastel tradicional + caldo de cana 500ml.',
          price_cents: 0,
          image: 'pastry/fair-combo.webp',
          groups: [
            {
              name: 'Sabor do pastel',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: savoryFlavors.map(({ name, price_delta_cents }) => ({
                name,
                price_delta_cents: price_delta_cents + 700
              }))
            }
          ]
        },
        {
          name: 'Combo Família',
          description: '4 pastéis tradicionais (carne, queijo, pizza ou frango) + refrigerante 2L.',
          price_cents: 6490,
          image: 'pastry/family-combo.webp'
        }
      ]
    },
    {
      name: 'Bebidas da Feira',
      products: [
        {
          name: 'Caldo de Cana',
          price_cents: 0,
          image: 'pastry/sugarcane-juice.webp',
          groups: [
            {
              name: 'Tamanho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: '300ml', price_delta_cents: 700 },
                { name: '500ml', price_delta_cents: 1000 },
                { name: '1 litro', price_delta_cents: 1700 }
              ]
            },
            {
              name: 'Sabor',
              min: 0,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Com limão', price_delta_cents: 0 },
                { name: 'Com abacaxi', price_delta_cents: 100 },
                { name: 'Com gengibre', price_delta_cents: 100 }
              ]
            }
          ]
        }
      ]
    },
    DRINKS
  ]
};
