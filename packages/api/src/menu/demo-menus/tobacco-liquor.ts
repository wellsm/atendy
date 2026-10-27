import type { DemoStockItem, DemoStockLink } from '../../stock/types';
import type { MenuImport } from '../repository';

import { StockUnit } from '../../stock/types';
import { PriceMode } from '../types';

// Stock items. Spirits are stocked in ml (a bottle sale takes the bottle, a copão 100 ml); the rest in units.

const unit = (
  name: string,
  balance: number,
  minQty: number,
  costCents: number,
  packages: DemoStockItem['packages'] = []
): DemoStockItem => ({
  name,
  unit: StockUnit.Unit,
  min_qty: minQty,
  balance,
  unit_cost_millicents: costCents * 1000,
  packages
});

const bottle = (name: string, ml: number, bottles: number, minBottles: number, costCents: number): DemoStockItem => ({
  name,
  unit: StockUnit.Milliliter,
  min_qty: ml * minBottles,
  balance: ml * bottles,
  unit_cost_millicents: Math.round((costCents * 1000) / ml),
  packages: [
    { name: 'Garrafa', factor: ml },
    { name: 'Caixa 6 garrafas', factor: ml * 6 }
  ]
});

const FARDO_12 = [{ name: 'Fardo 12 un.', factor: 12 }];
const FARDO_6 = [{ name: 'Fardo 6 un.', factor: 6 }];
const CAIXA_24 = [{ name: 'Caixa 24 un.', factor: 24 }];
const CAIXA_6 = [{ name: 'Caixa 6 garrafas', factor: 6 }];
const CAIXA_10 = [{ name: 'Caixa 10 un.', factor: 10 }];
const PACOTE_10 = [{ name: 'Pacote 10 maços', factor: 10 }];

const STOCK: DemoStockItem[] = [
  unit('Cerveja Brahma lata 350ml', 144, 48, 290, FARDO_12),
  unit('Cerveja Skol lata 350ml', 120, 48, 280, FARDO_12),
  unit('Cerveja Amstel lata 350ml', 96, 48, 330, FARDO_12),
  unit('Cerveja Budweiser lata 350ml', 72, 24, 340, FARDO_12),
  unit('Cerveja Heineken lata 350ml', 96, 48, 420, FARDO_12),
  unit('Cerveja Brahma Duplo Malte latão 473ml', 72, 24, 420, FARDO_12),
  unit('Cerveja Skol latão 473ml', 48, 24, 390, FARDO_12),
  unit('Cerveja Original latão 473ml', 48, 24, 520, FARDO_12),
  unit('Cerveja Heineken latão 473ml', 60, 24, 620, FARDO_12),
  unit('Cerveja Budweiser long neck 330ml', 48, 24, 480, CAIXA_24),
  unit('Cerveja Stella Artois long neck 330ml', 48, 24, 540, CAIXA_24),
  unit('Cerveja Heineken long neck 330ml', 72, 24, 560, CAIXA_24),
  unit('Cerveja Corona long neck 330ml', 48, 24, 650, CAIXA_24),

  bottle('Whisky Johnnie Walker Red Label 1L', 1000, 8, 3, 8900),
  bottle('Whisky Johnnie Walker Black Label 1L', 1000, 4, 2, 16500),
  bottle("Whisky Jack Daniel's 1L", 1000, 5, 2, 13500),
  // Starts at zero on purpose: the product and its copão option show as sold out.
  bottle('Gin Tanqueray 750ml', 750, 0, 2, 10500),
  bottle('Gin Beefeater 750ml', 750, 6, 3, 8200),
  bottle('Vodka Absolut 1L', 1000, 5, 2, 7600),
  bottle('Vodka Smirnoff 998ml', 998, 12, 4, 3300),
  bottle('Tequila José Cuervo Especial 750ml', 750, 3, 2, 9800),
  bottle('Cachaça 51 965ml', 965, 12, 4, 980),
  bottle('Jägermeister 700ml', 700, 3, 2, 11200),

  unit('Vinho Casillero del Diablo Cabernet Sauvignon 750ml', 12, 4, 4300, CAIXA_6),
  unit('Vinho Pérgola Tinto Suave 1L', 18, 6, 1700, CAIXA_6),
  unit('Vinho Santa Helena Reservado Sauvignon Blanc 750ml', 8, 4, 2600, CAIXA_6),
  unit('Espumante Chandon Brut 750ml', 6, 2, 7800, CAIXA_6),

  unit('Energético Red Bull 250ml', 72, 24, 750, CAIXA_24),
  unit('Energético Monster Tradicional 473ml', 48, 24, 690, FARDO_6),
  unit('Energético Monster Mango Loco 473ml', 24, 12, 690, FARDO_6),
  unit('Energético Monster Ultra 473ml', 24, 12, 690, FARDO_6),
  unit('Água tônica lata 350ml', 96, 24, 280, FARDO_12),
  unit('Coca-Cola lata 350ml', 96, 24, 290, FARDO_12),
  unit('Coca-Cola Zero lata 350ml', 48, 24, 290, FARDO_12),
  unit('Guaraná Antarctica lata 350ml', 72, 24, 260, FARDO_12),
  unit('Coca-Cola 2L', 24, 6, 820, FARDO_6),
  unit('Guaraná Antarctica 2L', 18, 6, 650, FARDO_6),
  unit('Água mineral sem gás 500ml', 48, 12, 110, FARDO_12),
  unit('Água mineral com gás 500ml', 24, 12, 130, FARDO_12),
  unit('Gelo em cubo 5kg', 25, 10, 700),
  unit('Gelo de coco', 60, 20, 120),
  unit('Gelo de maracujá', 45, 20, 120),
  unit('Gelo de melancia', 40, 20, 120),
  // Below the minimum on purpose: shows in the low-stock digest.
  unit('Gelo de morango', 8, 20, 120),
  unit('Copo descartável 700ml', 300, 100, 45, [{ name: 'Pacote 50 un.', factor: 50 }]),

  // Below the minimum on purpose: shows in the low-stock digest.
  unit('Essência Zomo Menta 50g', 4, 6, 1300, CAIXA_10),
  unit('Essência Zomo Uva com Menta 50g', 14, 6, 1300, CAIXA_10),
  unit('Essência Zomo Melancia 50g', 10, 6, 1300, CAIXA_10),
  unit('Essência Adalya Love 66 50g', 12, 5, 2100, CAIXA_10),
  unit('Essência Adalya Lady Killer 50g', 8, 5, 2100, CAIXA_10),
  unit('Essência Adalya Two Apples 50g', 6, 5, 2100, CAIXA_10),
  unit('Carvão de coco 1kg', 30, 10, 1600, [{ name: 'Caixa 10kg', factor: 10 }]),
  unit('Rosh de cerâmica', 10, 3, 1800),
  unit('Mangueira de silicone', 12, 4, 1300),
  unit('Narguilé médio', 4, 2, 13000),

  unit('Cigarro Rothmans maço 20', 30, 10, 750, PACOTE_10),
  unit('Cigarro Lucky Strike maço 20', 30, 10, 900, PACOTE_10),
  unit('Cigarro Dunhill maço 20', 20, 10, 1000, PACOTE_10),
  unit('Cigarro Marlboro Red maço 20', 60, 20, 1050, PACOTE_10),
  unit('Cigarro Marlboro Gold maço 20', 40, 20, 1050, PACOTE_10),
  unit('Cigarro de palha Paulistinha 20', 20, 6, 750),
  unit('Tabaco para enrolar 25g', 15, 5, 1000),
  unit('Seda Smoking Brown King Size', 50, 20, 300, [{ name: 'Caixa 25 un.', factor: 25 }]),
  unit('Piteira de papel', 40, 15, 180),
  unit('Isqueiro BIC Maxi', 36, 12, 450, [{ name: 'Display 50 un.', factor: 50 }]),
  unit('Dichavador de metal', 8, 3, 1000)
];

const take = (item: string, qty = 1): DemoStockLink[] => [{ item, qty }];

const option = (name: string, priceDelta: number, stock: DemoStockLink[]) => ({
  name,
  price_delta_cents: priceDelta,
  stock
});

const pick = (name: string, options: ReturnType<typeof option>[]) => ({
  name,
  min: 1,
  max: 1,
  price_mode: PriceMode.Sum,
  options
});

const image = (file: string) => `tobacco-liquor/${file}.webp`;

const canBrand = (qty: number, prices: [number, number, number, number, number]) =>
  pick('Marca', [
    option('Brahma', prices[0], take('Cerveja Brahma lata 350ml', qty)),
    option('Skol', prices[1], take('Cerveja Skol lata 350ml', qty)),
    option('Amstel', prices[2], take('Cerveja Amstel lata 350ml', qty)),
    option('Budweiser', prices[3], take('Cerveja Budweiser lata 350ml', qty)),
    option('Heineken', prices[4], take('Cerveja Heineken lata 350ml', qty))
  ]);

const cigaretteBrand = (qty: number, prices: [number, number, number, number, number]) =>
  pick('Marca', [
    option('Rothmans', prices[0], take('Cigarro Rothmans maço 20', qty)),
    option('Lucky Strike', prices[1], take('Cigarro Lucky Strike maço 20', qty)),
    option('Dunhill', prices[2], take('Cigarro Dunhill maço 20', qty)),
    option('Marlboro Red', prices[3], take('Cigarro Marlboro Red maço 20', qty)),
    option('Marlboro Gold', prices[4], take('Cigarro Marlboro Gold maço 20', qty))
  ]);

const COPAO_DOSE_ML = 100;

const flavoredIce = pick('Gelo saborizado', [
  option('Coco', 0, take('Gelo de coco')),
  option('Maracujá', 0, take('Gelo de maracujá')),
  option('Melancia', 0, take('Gelo de melancia')),
  option('Morango', 0, take('Gelo de morango'))
]);

const energyDrink = pick('Energético', [
  option('Red Bull', 0, take('Energético Red Bull 250ml')),
  option('Monster Tradicional', 0, take('Energético Monster Tradicional 473ml')),
  option('Monster Mango Loco', 0, take('Energético Monster Mango Loco 473ml'))
]);

const zomoFlavor = (name: string) =>
  pick(name, [
    option('Menta', 0, take('Essência Zomo Menta 50g')),
    option('Uva com Menta', 0, take('Essência Zomo Uva com Menta 50g')),
    option('Melancia', 0, take('Essência Zomo Melancia 50g'))
  ]);

const spirit = (name: string, description: string, price: number, file: string, ml: number) => ({
  name,
  description,
  price_cents: price,
  image: image(file),
  stock: take(name, ml)
});

export const TOBACCO_LIQUOR_MENU: MenuImport = {
  stock: STOCK,
  categories: [
    {
      name: 'Cervejas',
      products: [
        {
          name: 'Cerveja Lata 350ml',
          description: 'Lata gelada.',
          price_cents: 490,
          image: image('beer-can'),
          groups: [canBrand(1, [0, 0, 100, 100, 250])]
        },
        {
          name: 'Fardo 12 Latas 350ml',
          description: '12 latas geladas da mesma marca.',
          price_cents: 4790,
          image: image('beer-pack'),
          groups: [canBrand(12, [0, 0, 1000, 1000, 2500])]
        },
        {
          name: 'Cerveja Latão 473ml',
          description: 'Latão gelado.',
          price_cents: 690,
          image: image('beer-tall-can'),
          groups: [
            pick('Marca', [
              option('Brahma Duplo Malte', 0, take('Cerveja Brahma Duplo Malte latão 473ml')),
              option('Skol', 0, take('Cerveja Skol latão 473ml')),
              option('Original', 200, take('Cerveja Original latão 473ml')),
              option('Heineken', 300, take('Cerveja Heineken latão 473ml'))
            ])
          ]
        },
        {
          name: 'Cerveja Long Neck 330ml',
          description: 'Long neck gelada.',
          price_cents: 790,
          image: image('beer-long-neck'),
          groups: [
            pick('Marca', [
              option('Budweiser', 0, take('Cerveja Budweiser long neck 330ml')),
              option('Stella Artois', 100, take('Cerveja Stella Artois long neck 330ml')),
              option('Heineken', 100, take('Cerveja Heineken long neck 330ml')),
              option('Corona', 200, take('Cerveja Corona long neck 330ml'))
            ])
          ]
        }
      ]
    },
    {
      name: 'Destilados',
      products: [
        spirit('Whisky Johnnie Walker Red Label 1L', 'Blended scotch whisky.', 12990, 'whisky-red-label', 1000),
        spirit(
          'Whisky Johnnie Walker Black Label 1L',
          'Blended scotch whisky 12 anos.',
          22990,
          'whisky-black-label',
          1000
        ),
        spirit("Whisky Jack Daniel's 1L", 'Tennessee whiskey.', 18990, 'whisky-jack-daniels', 1000),
        spirit('Gin Tanqueray 750ml', 'London dry gin.', 14990, 'gin-tanqueray', 750),
        spirit('Gin Beefeater 750ml', 'London dry gin.', 11990, 'gin-beefeater', 750),
        spirit('Vodka Absolut 1L', 'Vodka sueca.', 10990, 'vodka-absolut', 1000),
        spirit('Vodka Smirnoff 998ml', 'Vodka tridestilada.', 4990, 'vodka-smirnoff', 998),
        spirit('Tequila José Cuervo Especial 750ml', 'Tequila prata.', 13990, 'tequila', 750),
        spirit('Cachaça 51 965ml', 'Cachaça tradicional.', 1690, 'cachaca', 965),
        spirit('Jägermeister 700ml', 'Licor de ervas alemão.', 15990, 'jagermeister', 700)
      ]
    },
    {
      name: 'Copões',
      products: [
        {
          name: 'Copão de Gin 700ml',
          description: '100 ml de gin, acompanhamento e gelo saborizado no copo de 700 ml.',
          price_cents: 2990,
          image: image('copao-gin'),
          stock: take('Copo descartável 700ml'),
          groups: [
            pick('Gin', [
              option('Beefeater', 0, take('Gin Beefeater 750ml', COPAO_DOSE_ML)),
              option('Tanqueray', 600, take('Gin Tanqueray 750ml', COPAO_DOSE_ML))
            ]),
            pick('Acompanhamento', [
              option('Água tônica', 0, take('Água tônica lata 350ml')),
              option('Red Bull', 300, take('Energético Red Bull 250ml'))
            ]),
            flavoredIce
          ]
        },
        {
          name: 'Copão de Whisky com Energético 700ml',
          description: '100 ml de whisky, 1 energético e gelo saborizado no copo de 700 ml.',
          price_cents: 3490,
          image: image('copao-whisky'),
          stock: take('Copo descartável 700ml'),
          groups: [
            pick('Whisky', [
              option('Red Label', 0, take('Whisky Johnnie Walker Red Label 1L', COPAO_DOSE_ML)),
              option('Black Label', 1200, take('Whisky Johnnie Walker Black Label 1L', COPAO_DOSE_ML)),
              option("Jack Daniel's", 800, take("Whisky Jack Daniel's 1L", COPAO_DOSE_ML))
            ]),
            energyDrink,
            flavoredIce
          ]
        },
        {
          name: 'Copão de Vodka com Energético 700ml',
          description: '100 ml de vodka, 1 energético e gelo saborizado no copo de 700 ml.',
          price_cents: 2690,
          image: image('copao-vodka'),
          stock: take('Copo descartável 700ml'),
          groups: [
            pick('Vodka', [
              option('Smirnoff', 0, take('Vodka Smirnoff 998ml', COPAO_DOSE_ML)),
              option('Absolut', 500, take('Vodka Absolut 1L', COPAO_DOSE_ML))
            ]),
            energyDrink,
            flavoredIce
          ]
        }
      ]
    },
    {
      name: 'Kits',
      products: [
        {
          name: 'Kit Gin Tônica',
          description: 'Gin Beefeater 750ml, 4 águas tônicas e gelo em cubo 5kg.',
          price_cents: 14990,
          image: image('kit-gin'),
          stock: [
            { item: 'Gin Beefeater 750ml', qty: 750 },
            { item: 'Água tônica lata 350ml', qty: 4 },
            { item: 'Gelo em cubo 5kg', qty: 1 }
          ]
        },
        {
          name: 'Kit Whisky com Energético',
          description: 'Johnnie Walker Red Label 1L, 4 Red Bull e gelo em cubo 5kg.',
          price_cents: 17990,
          image: image('kit-whisky'),
          stock: [
            { item: 'Whisky Johnnie Walker Red Label 1L', qty: 1000 },
            { item: 'Energético Red Bull 250ml', qty: 4 },
            { item: 'Gelo em cubo 5kg', qty: 1 }
          ]
        }
      ]
    },
    {
      name: 'Vinhos e Espumantes',
      products: [
        {
          name: 'Vinho Tinto Casillero del Diablo Cabernet Sauvignon 750ml',
          description: 'Tinto seco chileno.',
          price_cents: 6990,
          image: image('wine-red-dry'),
          stock: take('Vinho Casillero del Diablo Cabernet Sauvignon 750ml')
        },
        {
          name: 'Vinho Tinto Suave Pérgola 1L',
          description: 'Tinto suave nacional.',
          price_cents: 2990,
          image: image('wine-red-sweet'),
          stock: take('Vinho Pérgola Tinto Suave 1L')
        },
        {
          name: 'Vinho Branco Santa Helena Reservado Sauvignon Blanc 750ml',
          description: 'Branco seco chileno.',
          price_cents: 4490,
          image: image('wine-white'),
          stock: take('Vinho Santa Helena Reservado Sauvignon Blanc 750ml')
        },
        {
          name: 'Espumante Chandon Brut 750ml',
          description: 'Espumante brut nacional.',
          price_cents: 11990,
          image: image('sparkling-wine'),
          stock: take('Espumante Chandon Brut 750ml')
        }
      ]
    },
    {
      name: 'Bebidas sem Álcool e Gelo',
      products: [
        {
          name: 'Energético Red Bull 250ml',
          price_cents: 1190,
          image: image('red-bull'),
          stock: take('Energético Red Bull 250ml')
        },
        {
          name: 'Energético Monster 473ml',
          price_cents: 1190,
          image: image('monster'),
          groups: [
            pick('Sabor', [
              option('Tradicional', 0, take('Energético Monster Tradicional 473ml')),
              option('Mango Loco', 0, take('Energético Monster Mango Loco 473ml')),
              option('Ultra', 0, take('Energético Monster Ultra 473ml'))
            ])
          ]
        },
        {
          name: 'Água Tônica Lata 350ml',
          price_cents: 550,
          image: image('tonic-water'),
          stock: take('Água tônica lata 350ml')
        },
        {
          name: 'Refrigerante Lata 350ml',
          price_cents: 600,
          image: image('soda-can'),
          groups: [
            pick('Sabor', [
              option('Coca-Cola', 0, take('Coca-Cola lata 350ml')),
              option('Coca-Cola Zero', 0, take('Coca-Cola Zero lata 350ml')),
              option('Guaraná Antarctica', 0, take('Guaraná Antarctica lata 350ml'))
            ])
          ]
        },
        {
          name: 'Refrigerante 2L',
          price_cents: 1190,
          image: image('soda-2l'),
          groups: [
            pick('Sabor', [
              option('Coca-Cola', 200, take('Coca-Cola 2L')),
              option('Guaraná Antarctica', 0, take('Guaraná Antarctica 2L'))
            ])
          ]
        },
        {
          name: 'Água Mineral 500ml',
          price_cents: 350,
          image: image('water'),
          groups: [
            pick('Tipo', [
              option('Sem gás', 0, take('Água mineral sem gás 500ml')),
              option('Com gás', 50, take('Água mineral com gás 500ml'))
            ])
          ]
        },
        {
          name: 'Gelo em Cubo 5kg',
          price_cents: 1590,
          image: image('ice-bag'),
          stock: take('Gelo em cubo 5kg')
        },
        {
          name: 'Gelo Saborizado',
          description: 'Cubo de gelo de fruta para drinks.',
          price_cents: 350,
          image: image('flavored-ice'),
          groups: [
            pick('Sabor', [
              option('Coco', 0, take('Gelo de coco')),
              option('Maracujá', 0, take('Gelo de maracujá')),
              option('Melancia', 0, take('Gelo de melancia')),
              option('Morango', 0, take('Gelo de morango'))
            ])
          ]
        }
      ]
    },
    {
      name: 'Narguilé',
      products: [
        {
          name: 'Essência Zomo 50g',
          price_cents: 2290,
          image: image('hookah-tobacco-zomo'),
          groups: [zomoFlavor('Sabor')]
        },
        {
          name: 'Essência Adalya 50g',
          price_cents: 3490,
          image: image('hookah-tobacco-adalya'),
          groups: [
            pick('Sabor', [
              option('Love 66', 0, take('Essência Adalya Love 66 50g')),
              option('Lady Killer', 0, take('Essência Adalya Lady Killer 50g')),
              option('Two Apples', 0, take('Essência Adalya Two Apples 50g'))
            ])
          ]
        },
        {
          name: 'Carvão de Coco 1kg',
          description: 'Carvão de casca de coco em cubos para narguilé.',
          price_cents: 2990,
          image: image('coconut-charcoal'),
          stock: take('Carvão de coco 1kg')
        },
        {
          name: 'Rosh de Cerâmica',
          price_cents: 3990,
          image: image('hookah-bowl'),
          stock: take('Rosh de cerâmica')
        },
        {
          name: 'Mangueira de Silicone',
          price_cents: 2990,
          image: image('hookah-hose'),
          stock: take('Mangueira de silicone')
        },
        {
          name: 'Narguilé Médio',
          description: 'Narguilé de 55 cm com base de vidro, rosh e mangueira.',
          price_cents: 24990,
          image: image('hookah'),
          stock: take('Narguilé médio')
        },
        {
          name: 'Kit Narguilé Completo',
          description: 'Narguilé médio, 1 essência Zomo à escolha e carvão de coco 1kg.',
          price_cents: 28990,
          image: image('hookah-kit'),
          stock: [
            { item: 'Narguilé médio', qty: 1 },
            { item: 'Carvão de coco 1kg', qty: 1 }
          ],
          groups: [zomoFlavor('Essência')]
        }
      ]
    },
    {
      name: 'Cigarros e Tabaco',
      products: [
        {
          name: 'Maço de Cigarro (20 un.)',
          price_cents: 900,
          image: image('cigarette-pack'),
          groups: [cigaretteBrand(1, [0, 200, 350, 400, 400])]
        },
        {
          name: 'Pacote de Cigarro (10 maços)',
          price_cents: 8500,
          image: image('cigarette-carton'),
          groups: [cigaretteBrand(10, [0, 1900, 3300, 3800, 3800])]
        },
        {
          name: 'Cigarro de Palha Paulistinha (20 un.)',
          price_cents: 1290,
          image: image('straw-cigarettes'),
          stock: take('Cigarro de palha Paulistinha 20')
        },
        {
          name: 'Tabaco para Enrolar 25g',
          price_cents: 1890,
          image: image('rolling-tobacco'),
          stock: take('Tabaco para enrolar 25g')
        },
        {
          name: 'Seda Smoking Brown King Size',
          price_cents: 650,
          image: image('rolling-papers'),
          stock: take('Seda Smoking Brown King Size')
        },
        {
          name: 'Piteira de Papel',
          description: 'Bloco de piteiras de papel.',
          price_cents: 450,
          image: image('paper-tips'),
          stock: take('Piteira de papel')
        },
        {
          name: 'Isqueiro BIC Maxi',
          price_cents: 890,
          image: image('lighter'),
          stock: take('Isqueiro BIC Maxi')
        },
        {
          name: 'Dichavador de Metal',
          price_cents: 2490,
          image: image('grinder'),
          stock: take('Dichavador de metal')
        }
      ]
    }
  ]
};
