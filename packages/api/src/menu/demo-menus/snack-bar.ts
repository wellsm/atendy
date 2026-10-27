import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { DRINKS } from './drinks';

const extras = {
  name: 'Adicionais',
  min: 0,
  max: 5,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Bacon', price_delta_cents: 400 },
    { name: 'Ovo', price_delta_cents: 250 },
    { name: 'Queijo', price_delta_cents: 300 },
    { name: 'Catupiry', price_delta_cents: 400 },
    { name: 'Calabresa', price_delta_cents: 400 },
    { name: 'Hambúrguer extra', price_delta_cents: 600 },
    { name: 'Frango desfiado', price_delta_cents: 500 }
  ]
};

const removals = {
  name: 'Retirar',
  min: 0,
  max: 4,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Sem cebola', price_delta_cents: 0 },
    { name: 'Sem tomate', price_delta_cents: 0 },
    { name: 'Sem alface', price_delta_cents: 0 },
    { name: 'Sem milho e ervilha', price_delta_cents: 0 },
    { name: 'Sem maionese', price_delta_cents: 0 }
  ]
};

const snack = (name: string, description: string, price: number, image: string) => ({
  name,
  description,
  price_cents: price,
  image: `snack-bar/${image}.webp`,
  groups: [extras, removals]
});

export const SNACK_BAR_MENU: MenuImport = {
  categories: [
    {
      name: 'Lanches',
      products: [
        snack('X-Burguer', 'Pão, hambúrguer, queijo e maionese.', 1890, 'x-burger'),
        snack('X-Salada', 'Pão, hambúrguer, queijo, alface, tomate e maionese.', 2090, 'x-salad'),
        snack('X-Bacon', 'Pão, hambúrguer, queijo, bacon, alface, tomate e maionese.', 2490, 'x-bacon'),
        snack('X-Egg', 'Pão, hambúrguer, queijo, ovo, alface, tomate e maionese.', 2290, 'x-egg'),
        snack('X-Calabresa', 'Pão, hambúrguer, calabresa, queijo, cebola e maionese.', 2490, 'x-sausage'),
        snack('X-Frango', 'Pão, frango desfiado, catupiry, milho, alface e tomate.', 2490, 'x-chicken'),
        snack(
          'X-Tudo',
          'Pão, 2 hambúrgueres, queijo, presunto, bacon, ovo, calabresa, alface, tomate, milho e batata palha.',
          3490,
          'x-everything'
        ),
        snack('Misto Quente', 'Pão de forma, presunto e queijo na chapa.', 1290, 'grilled-ham-cheese'),
        snack('Bauru', 'Pão francês, rosbife, queijo, tomate e orégano.', 1890, 'bauru'),
        snack('Americano', 'Pão de forma, presunto, queijo, ovo, alface e tomate.', 1690, 'american-sandwich')
      ]
    },
    {
      name: 'Cachorro-Quente',
      products: [
        {
          name: 'Dogão',
          description: 'Pão, 2 salsichas, molho de tomate, milho, ervilha, purê e batata palha.',
          price_cents: 1890,
          image: 'snack-bar/hot-dog.webp',
          groups: [extras, removals]
        },
        {
          name: 'Dog Simples',
          description: 'Pão, salsicha, molho e batata palha.',
          price_cents: 1190,
          image: 'snack-bar/simple-hot-dog.webp',
          groups: [extras]
        }
      ]
    },
    {
      name: 'Pratos e Porções',
      products: [
        {
          name: 'Prato Feito',
          description: 'Arroz, feijão, salada, batata frita e a proteína escolhida.',
          price_cents: 0,
          image: 'snack-bar/prato-feito.webp',
          groups: [
            {
              name: 'Proteína',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Bife acebolado', price_delta_cents: 2690 },
                { name: 'Frango grelhado', price_delta_cents: 2390 },
                { name: 'Calabresa acebolada', price_delta_cents: 2290 },
                { name: 'Omelete', price_delta_cents: 2090 },
                { name: 'Filé de peixe', price_delta_cents: 2790 }
              ]
            },
            {
              name: 'Adicional',
              min: 0,
              max: 2,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Ovo frito', price_delta_cents: 300 },
                { name: 'Farofa', price_delta_cents: 300 }
              ]
            }
          ]
        },
        {
          name: 'Porção de Batata Frita',
          price_cents: 0,
          image: 'snack-bar/fries-portion.webp',
          groups: [
            {
              name: 'Tamanho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Meia', price_delta_cents: 1890 },
                { name: 'Inteira', price_delta_cents: 2990 }
              ]
            },
            {
              name: 'Cobertura',
              min: 0,
              max: 2,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Cheddar', price_delta_cents: 600 },
                { name: 'Bacon', price_delta_cents: 600 },
                { name: 'Calabresa', price_delta_cents: 600 }
              ]
            }
          ]
        },
        { name: 'Porção de Calabresa Acebolada', price_cents: 3490, image: 'snack-bar/sausage-portion.webp' },
        { name: 'Porção de Frango a Passarinho', price_cents: 3990, image: 'snack-bar/fried-chicken-portion.webp' },
        { name: 'Porção de Mandioca Frita', price_cents: 2790, image: 'snack-bar/cassava-portion.webp' }
      ]
    },
    {
      name: 'Salgados',
      products: [
        {
          name: 'Salgado Frito',
          description: 'Unidade.',
          price_cents: 0,
          image: 'snack-bar/fried-snacks.webp',
          groups: [
            {
              name: 'Sabor',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Coxinha de frango', price_delta_cents: 800 },
                { name: 'Coxinha com catupiry', price_delta_cents: 900 },
                { name: 'Kibe', price_delta_cents: 800 },
                { name: 'Risole de presunto e queijo', price_delta_cents: 800 },
                { name: 'Bolinha de queijo', price_delta_cents: 800 },
                { name: 'Enroladinho de salsicha', price_delta_cents: 700 }
              ]
            }
          ]
        },
        {
          name: 'Pão de Queijo',
          description: 'Porção com 6 unidades.',
          price_cents: 1290,
          image: 'snack-bar/cheese-bread.webp'
        }
      ]
    },
    {
      name: 'Açaí e Sobremesas',
      products: [
        {
          name: 'Açaí no Copo',
          price_cents: 0,
          image: 'snack-bar/acai-cup.webp',
          groups: [
            {
              name: 'Tamanho',
              min: 1,
              max: 1,
              price_mode: PriceMode.Sum,
              options: [
                { name: '300ml', price_delta_cents: 1490 },
                { name: '500ml', price_delta_cents: 1990 }
              ]
            },
            {
              name: 'Complementos',
              min: 0,
              max: 3,
              price_mode: PriceMode.Sum,
              options: [
                { name: 'Granola', price_delta_cents: 0 },
                { name: 'Banana', price_delta_cents: 0 },
                { name: 'Leite em pó', price_delta_cents: 0 },
                { name: 'Leite condensado', price_delta_cents: 0 },
                { name: 'Paçoca', price_delta_cents: 0 }
              ]
            }
          ]
        },
        { name: 'Pudim', description: 'Fatia.', price_cents: 890, image: 'snack-bar/flan.webp' },
        { name: 'Mousse de Maracujá', price_cents: 790, image: 'snack-bar/passion-fruit-mousse.webp' }
      ]
    },
    DRINKS
  ]
};
