import type { DemoStockItem } from '../../stock/types';
import type { MenuImport } from '../repository';

import { StockUnit } from '../../stock/types';
import { PriceMode } from '../types';

type Item = {
  name: string;
  description?: string;
  price: number;
  image: string;
  /**
   * Opening balance and minimum (units); cost is about half the price.
   */
  balance: number;
  min: number;
};

const item = (
  name: string,
  price: number,
  image: string,
  balance: number,
  min: number,
  description?: string
): Item => ({ name, price, image, balance, min, ...(description && { description }) });

const image = (file: string) => `cosmetics/${file}.webp`;

type Product = MenuImport['categories'][number]['products'][number];

// Each item is a product and its own stock item, by the same name; `extra` products take no stock.
const CATEGORIES: { name: string; items: Item[]; extra?: Product[] }[] = [
  {
    name: 'Perfumes',
    items: [
      item('Perfume Árabe Yara', 35000, 'perfume-yara', 4, 2, 'Perfume árabe feminino, doce e floral.'),
      item('Perfume Árabe Assad', 35000, 'perfume-asad', 3, 2, 'Perfume árabe masculino, amadeirado e marcante.'),
      item('Perfume Árabe Rose VIP', 35000, 'perfume-rose-vip', 2, 2, 'Perfume árabe feminino com notas de rosa.'),
      item('Perfume Floratta Natura', 30000, 'perfume-floratta', 3, 2, 'Perfume feminino floral.'),
      // Starts at zero on purpose: shows as sold out.
      item('Perfume Malbec Icon', 30000, 'perfume-malbec', 0, 1, 'Perfume masculino amadeirado.')
    ]
  },
  {
    name: 'Corpo e Banho',
    items: [
      item('Hidratante Corporal', 1999, 'body-lotion', 12, 4),
      item('Hidratante Todo Dia', 2500, 'todo-dia-lotion', 10, 4),
      item('Creme Lili Natura', 15000, 'lili-cream', 3, 1, 'Creme acetinado perfumado para o corpo.'),
      item('Esfoliante', 1999, 'scrub', 8, 3, 'Esfoliante corporal.'),
      item('Desodorante Roll-on', 1900, 'roll-on-deodorant', 15, 5)
    ]
  },
  {
    name: 'Maquiagem e Rosto',
    items: [
      item('Lápis de Olho Preto', 1500, 'eyeliner-pencil', 20, 5),
      item('Máscara de Cílios', 1500, 'mascara', 14, 5),
      item('Caneta Delineadora', 1500, 'eyeliner-pen', 10, 5),
      item('Sérum Facial para Olheiras', 1999, 'eye-serum', 6, 3)
    ]
  },
  {
    name: 'Cabelos',
    items: [
      item("Tinta de Cabelo L'Oréal 7.7", 2000, 'hair-dye', 9, 3, 'Tonalidade 7.7.'),
      item('Tônico de Crescimento', 2000, 'hair-tonic', 7, 3, 'Tônico capilar para crescimento.'),
      item('Shampoo Infantil', 1200, 'kids-shampoo', 10, 4),
      item('Condicionador Infantil', 1400, 'kids-conditioner', 10, 4)
    ]
  },
  {
    name: 'Unhas',
    items: [
      item('Esmalte Impala', 500, 'nail-polish', 40, 10),
      // Below the minimum on purpose: shows in the low-stock digest.
      item('Acetona', 1000, 'acetone', 3, 6)
    ]
  },
  {
    name: 'Acessórios',
    items: [
      item('Brinco Argola', 1200, 'hoop-earrings', 15, 5),
      item('Pulseira Virgínia', 1200, 'bracelet', 12, 5),
      item('Colar de Trevo', 1500, 'clover-necklace', 10, 4),
      item('Bolsa de Ombro Preta', 3000, 'shoulder-bag-black', 5, 2),
      item('Bolsa de Ombro Branca', 3000, 'shoulder-bag-white', 4, 2)
    ]
  },
  {
    name: 'Kits e Presentes',
    items: [item('Kit Natura', 25000, 'kit-natura', 3, 1, 'Kit presente Natura.')],
    extra: [
      {
        name: 'Kit Dia dos Namorados',
        description: 'A partir de R$ 50,00. Escolha o tamanho do kit.',
        price_cents: 5000,
        image: image('valentines-kit'),
        groups: [
          {
            name: 'Tamanho do kit',
            min: 1,
            max: 1,
            price_mode: PriceMode.Sum,
            options: [
              { name: 'Essencial', price_delta_cents: 0 },
              { name: 'Romântico', price_delta_cents: 4000 },
              { name: 'Luxo', price_delta_cents: 10000 }
            ]
          }
        ]
      }
    ]
  }
];

const STOCK: DemoStockItem[] = CATEGORIES.flatMap(({ items }) =>
  items.map(({ name, price, balance, min }) => ({
    name,
    unit: StockUnit.Unit,
    min_qty: min,
    balance,
    unit_cost_millicents: Math.round(price / 2) * 1000,
    packages: []
  }))
);

export const COSMETICS_MENU: MenuImport = {
  stock: STOCK,
  categories: CATEGORIES.map(({ name, items, extra = [] }) => ({
    name,
    products: [
      ...items.map(({ name: product, description, price, image: file }) => ({
        name: product,
        ...(description && { description }),
        price_cents: price,
        image: image(file),
        stock: [{ item: product, qty: 1 }]
      })),
      ...extra
    ]
  }))
};
