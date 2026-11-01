import type { MenuImport } from '../repository';

import { PriceMode } from '../types';
import { CAIXA_24, drinkItem, FARDO_12, takeOne } from './drinks';

// Drink stock items carry the drink's own name, so products and the upsell options link by name.
const STOCK = [
  drinkItem('H2O Limão 500ml', 24, 12, 380, FARDO_12),
  drinkItem('H2O Limoneto 500ml', 24, 12, 380, FARDO_12),
  drinkItem('Heineken 330ml', 24, 12, 560, CAIXA_24),
  drinkItem('Corona 350ml', 24, 12, 650, CAIXA_24),
  drinkItem('Budweiser 330ml', 24, 12, 480, CAIXA_24),
  drinkItem('Coca-Cola 350ml', 48, 12, 350, FARDO_12),
  drinkItem('Coca-Cola Zero 350ml', 48, 12, 350, FARDO_12),
  drinkItem('Guaraná Antarctica 350ml', 48, 12, 290, FARDO_12),
  drinkItem('Guaraná Antarctica Zero 350ml', 48, 12, 290, FARDO_12),
  drinkItem('Schweppes Citrus 350ml', 24, 12, 330, FARDO_12),
  drinkItem('Sprite 350ml', 48, 12, 290, FARDO_12),
  drinkItem('Água mineral 350ml', 24, 12, 110, FARDO_12),
  drinkItem('Água mineral com gás 350ml', 24, 12, 150, FARDO_12)
];

/**
 * Real-world shape (an iFood sushi delivery): every dish carries the same free kit choice, paid extras and a drink
 * upsell; pokes add a required protein and allow fewer drinks.
 */
const kit = {
  name: 'Kit Shoyu 30ml, Tarê 25ml e 1 par de hashi - Grátis',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Sim, obrigado', price_delta_cents: 0 },
    { name: 'Não, obrigado', price_delta_cents: 0 }
  ]
};

const extras = {
  name: 'Adicionais',
  min: 0,
  max: 5,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Kit Shoyu 30ml, Tarê 25ml e 1 par de hashi', price_delta_cents: 290 },
    { name: 'Hashi', price_delta_cents: 99 },
    { name: 'Shoyu 30ml', price_delta_cents: 199 },
    { name: 'Tarê 25ml', price_delta_cents: 199 },
    { name: 'Gengibre (Gari)', price_delta_cents: 150 },
    { name: 'Wasabi', price_delta_cents: 150 }
  ]
};

const drinkUpsell = (max: number) => ({
  name: 'Adicionar uma bebida?',
  min: 0,
  max,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Coca-Cola Zero 350ml', price_delta_cents: 690 },
    { name: 'Coca-Cola 350ml', price_delta_cents: 690 },
    { name: 'Corona 350ml', price_delta_cents: 1290 },
    { name: 'Guaraná Antarctica 350ml', price_delta_cents: 690 },
    { name: 'Guaraná Antarctica Zero 350ml', price_delta_cents: 690 },
    { name: 'Heineken 330ml', price_delta_cents: 1290 },
    { name: 'Schweppes Citrus 350ml', price_delta_cents: 690 },
    { name: 'Sprite 350ml', price_delta_cents: 690 },
    { name: 'Água mineral 350ml', price_delta_cents: 490 },
    { name: 'Água mineral com gás 350ml', price_delta_cents: 490 }
  ].map((option) => ({ ...option, stock: takeOne(option.name) }))
});

const protein = {
  name: 'Escolha sua proteína',
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options: [
    { name: 'Salmão em cubos', price_delta_cents: 0 },
    { name: 'Salmão grelhado', price_delta_cents: 0 },
    { name: 'Atum em cubos', price_delta_cents: 0 },
    { name: 'Peixe branco (prego)', price_delta_cents: 0 },
    { name: 'Salmão batido', price_delta_cents: 0 },
    { name: 'Shimeji', price_delta_cents: 0 }
  ]
};

const DISH_GROUPS = [kit, extras, drinkUpsell(5)];

const NO_SWAP = ' *Não fazemos troca de nenhuma peça do combinado.*';

const dish = (name: string, description: string, price: number, image?: string) => ({
  name,
  description,
  price_cents: price,
  ...(image && { image: `japanese/${image}.webp` }),
  groups: DISH_GROUPS
});

const poke = (name: string, description: string, price: number) => ({
  name,
  description,
  price_cents: price,
  groups: [protein, kit, extras, drinkUpsell(2)]
});

const drink = (name: string, price: number, description?: string) => ({
  name,
  ...(description && { description }),
  price_cents: price,
  stock: takeOne(name)
});

export const JAPANESE_MENU: MenuImport = {
  stock: STOCK,
  categories: [
    {
      name: 'Hot Rolls',
      products: [
        dish('Hot Roll', '8 unid. de hot roll com cream cheese, gergelim, tarê e cebolinha.', 3090, 'hot-philadelphia'),
        dish('Hot Roll Couve Crispy', '8 unid. de hot roll com cream cheese, gergelim, tarê e couve crispy.', 3290)
      ]
    },
    {
      name: 'Poke',
      products: [
        poke(
          'Poke Especial',
          'Poke com 1 proteína à sua escolha, arroz japonês (shari), gergelim, cebola roxa, cream cheese, sunomono (pepino), kani e batata crispy. Não fazemos alterações.',
          4980
        ),
        poke(
          'Poke Fruit',
          'Poke com 1 proteína à sua escolha, arroz japonês (shari), gergelim, manga, cream cheese, sunomono (pepino), kani e couve crispy. Não fazemos alterações.',
          5250
        )
      ]
    },
    {
      name: 'Dog Hot',
      products: [
        dish(
          'Dog Hot Philadelphia',
          'Um super hot roll recheado de salmão grelhado, cream cheese, gergelim, cebolinha e molho tarê.',
          3990
        ),
        dish(
          'Dog Hot da Casa',
          'Um super hot roll recheado de salmão cru em cubos, cream cheese, gergelim, cebolinha e molho tarê.',
          3990
        ),
        dish('Dog Hot Camarão', 'Um super hot roll recheado de camarão grelhado, cream cheese e cebolinha.', 4490)
      ]
    },
    {
      name: 'Combinados',
      products: [
        dish(
          'Combinado Tradicional 16 peças',
          `6 hot roll, 3 hossomaki salmão, 3 hossomaki pepino, 2 uramaki califórnia e 2 niguiri salmão.${NO_SWAP}`,
          4490,
          'combo-20'
        ),
        dish(
          'Combinado da Casa 14 peças',
          `3 niguiri salmão trufado, 3 dyo salmão com laranja caramelizada e mel, 3 hossomaki salmão, 3 dyo salmão com camarão e geleia de pimenta e 2 uramaki philadelphia.${NO_SWAP}`,
          5990
        ),
        dish(
          'Combinado Maçaricado 13 peças',
          `2 sashimi, 2 niguiri e 2 dyo de salmão maçaricados, 3 hot roll tradicional e 3 hot roll couve crispy.${NO_SWAP}`,
          4690
        ),
        dish(
          'Combinado 100% Salmão 13 peças',
          `3 niguiri, 3 hossomaki e 3 dyo de salmão e 4 uramaki philadelphia.${NO_SWAP}`,
          5490,
          'salmon-combo'
        )
      ]
    },
    {
      name: 'Combinados para Dividir',
      products: [
        dish(
          'Combinado Tradicional 32 peças',
          `8 hot roll, 8 hossomaki pepino, 6 uramaki califórnia, 6 uramaki philadelphia e 4 niguiri salmão.${NO_SWAP}`,
          8490,
          'combo-30'
        ),
        dish(
          'Combinado 100% Salmão 36 peças',
          `4 sashimi, 4 niguiri, 8 hossomaki e 7 dyo de salmão, 6 uramaki philadelphia e 7 hot roll.${NO_SWAP}`,
          11890
        ),
        dish(
          'Combinado Maçaricado 31 peças',
          `4 sashimi, 6 niguiri e 7 dyo de salmão maçaricados, 7 hot roll tradicional e 7 hot roll couve crispy.${NO_SWAP}`,
          9290
        ),
        dish(
          'Combinado da Casa 37 peças',
          `4 niguiri salmão trufado, 4 sashimi salmão, 6 uramaki philadelphia, 4 dyo salmão com camarão e geleia de pimenta, 4 dyo salmão com laranja caramelizada e mel, 8 hossomaki salmão e 7 hot roll.${NO_SWAP}`,
          12490,
          'combo-50'
        )
      ]
    },
    {
      name: 'Temakis',
      products: [
        dish('Temaki de Salmão', 'Arroz, salmão batido, cream cheese e cebolinha.', 3890, 'temaki'),
        dish('Temaki de Atum', 'Arroz, atum em cubos, cream cheese e cebolinha.', 3990),
        dish('Temaki de Camarão Empanado', 'Arroz, camarão empanado, cream cheese e cebolinha.', 4190),
        dish('Temaki Califórnia', 'Arroz, manga, pepino, kani e cream cheese.', 3290),
        dish('Temaki de Salmão Grelhado', 'Arroz, salmão grelhado, cream cheese e cebolinha.', 3890)
      ]
    },
    {
      name: 'Sushis e Sashimis',
      products: [
        dish('Sashimi de Salmão', '16 fatias do nosso salmão especial.', 5390, 'salmon-sashimi'),
        dish('Sashimi de Atum', '16 fatias de atum.', 5990),
        dish('Mix de Sashimi', '8 fatias de atum e 8 fatias de salmão.', 5790),
        dish(
          'Niguiri Salmão Trufado',
          '8 unid. de niguiri de salmão com azeite trufado, flor de sal e raspas de limão-siciliano.',
          3890,
          'salmon-nigiri'
        ),
        dish('Dyo Laranjinha', '10 unid. de dyo de salmão com cream cheese, laranja caramelizada e mel.', 3890),
        dish('Dyo Ebi', '10 unid. de dyo de salmão com camarão e geleia de pimenta.', 3890)
      ]
    },
    {
      name: 'Pratos Quentes',
      products: [
        dish('Teppan Salmão', '4 pedaços de salmão grelhado, acompanha yakimeshi.', 8490, 'salmon-teppan'),
        dish('Shimeji', 'Shimeji cozido e finalizado com cebolinha.', 3600),
        dish('Yakissoba Clássico', 'Macarrão, legumes, frango e carne.', 4890, 'yakisoba'),
        dish('Camarão Catupiry', '8 unid. de camarão empanado com Catupiry. Crocante e cremoso.', 5190),
        dish('Yakissoba Mix', 'Macarrão, legumes, frango, carne e camarão.', 5490),
        dish('Bolinho de Salmão', '8 unid. de bolinho de salmão sem massa, com cream cheese, empanado na panko.', 3590),
        dish('Harumaki de Queijo', '8 rolinhos primavera de massa crocante.', 2790, 'harumaki'),
        dish('Guioza de Carne', '8 unid. de trouxinhas recheadas de carne, fritas.', 3590, 'gyoza')
      ]
    },
    {
      name: 'Sobremesas',
      products: [
        { name: 'Brownie de Nutella', description: 'Brownie de chocolate com ganache de Nutella.', price_cents: 1890 }
      ]
    },
    {
      name: 'Bebidas',
      products: [
        drink('H2O Limão 500ml', 1290),
        drink('H2O Limoneto 500ml', 1290),
        drink('Heineken 330ml', 1290, 'Produto para maiores de 18 anos.'),
        drink('Corona 350ml', 1290, 'Produto para maiores de 18 anos.'),
        drink('Budweiser 330ml', 1290, 'Produto para maiores de 18 anos.'),
        drink('Coca-Cola 350ml', 690),
        drink('Coca-Cola Zero 350ml', 790),
        drink('Guaraná Antarctica 350ml', 790),
        drink('Guaraná Antarctica Zero 350ml', 790),
        drink('Schweppes Citrus 350ml', 790),
        drink('Sprite 350ml', 690),
        drink('Água mineral 350ml', 490),
        drink('Água mineral com gás 350ml', 490)
      ]
    }
  ]
};
