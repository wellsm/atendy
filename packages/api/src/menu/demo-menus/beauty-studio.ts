import type { MenuImport } from '../repository';

type Product = MenuImport['categories'][number]['products'][number];

/**
 * A service: the duration goes in the description, so the bot can tell it; no stock and no options.
 */
const service = (name: string, price_cents: number, duration: string, image: string, about: string): Product => ({
  name,
  price_cents,
  description: `${about} Duração: ${duration}.`,
  image: `beauty-studio/${image}.webp`
});

/**
 * Beauty studio (lashes, waxing, skin care, nails, brows). Services are booked through the store's link, so this menu
 * suits a redirect store: the bot answers prices and durations and sends the booking link.
 */
export const BEAUTY_STUDIO_MENU: MenuImport = {
  categories: [
    {
      name: 'Cílios',
      products: [
        service('Extensão de Cílios', 18000, '2 h 30 min', 'lash-extension', 'Aplicação fio a fio de cílios.'),
        service('Lash Lifting', 12000, '1 h 30 min', 'lash-lifting', 'Curvatura e tintura dos cílios naturais.'),
        service('Manutenção de Cílios 15 dias', 10000, '2 h', 'lash-refill', 'Reposição da extensão em até 15 dias.'),
        service(
          'Manutenção de Cílios 20 dias',
          12000,
          '2 h',
          'lash-refill-20',
          'Reposição da extensão em até 20 dias.'
        ),
        service('Remoção de Cílios', 4000, '30 min', 'lash-removal', 'Remoção segura da extensão.')
      ]
    },
    {
      name: 'Epilação',
      products: [
        service('Epilação Buço', 2000, '30 min', 'upper-lip-waxing', 'Epilação com cera.'),
        service('Epilação Completa Rosto', 6000, '30 min', 'face-waxing', 'Buço, queixo, bochechas e testa.')
      ]
    },
    {
      name: 'Estética',
      products: [
        service(
          'Dermaplaning',
          15000,
          '1 h',
          'dermaplaning',
          'Esfoliação com lâmina que remove células mortas e pelinhos.'
        ),
        service('Hidragloss Lips', 12000, '1 h', 'hydragloss-lips', 'Hidratação profunda dos lábios com efeito gloss.'),
        service('Limpeza de Pele', 15000, '1 h 30 min', 'facial-cleansing', 'Limpeza profunda com extração e máscara.')
      ]
    },
    {
      name: 'Nail Designer',
      products: [
        service('Alongamento Molde F1', 18000, '3 h', 'nail-extension', 'Alongamento de unhas em gel com molde F1.'),
        service('Banho em Gel', 12000, '2 h 30 min', 'gel-overlay', 'Camada de gel sobre a unha natural.'),
        service('Esmaltação em Gel Mão', 7000, '1 h 30 min', 'gel-polish-hands', 'Esmalte em gel nas mãos.'),
        service('Esmaltação em Gel Pé', 7000, '1 h 30 min', 'gel-polish-feet', 'Esmalte em gel nos pés.'),
        service('Manicure', 3500, '1 h', 'manicure', 'Cutilagem e esmaltação comum nas mãos.'),
        service(
          'Manicure e Pedicure',
          6500,
          '2 h 15 min',
          'manicure-pedicure',
          'Cutilagem e esmaltação nas mãos e nos pés.'
        ),
        service(
          'Manutenção de Alongamento',
          13000,
          '2 h',
          'nail-extension-refill',
          'Manutenção do alongamento em gel.'
        ),
        service('Pedicure', 4000, '1 h', 'pedicure', 'Cutilagem e esmaltação comum nos pés.')
      ]
    },
    {
      name: 'Sobrancelha',
      products: [
        service('Brow Lamination', 12000, '1 h', 'brow-lamination', 'Alinhamento dos fios para sobrancelhas cheias.'),
        service('Design com Henna', 5000, '1 h', 'brow-henna', 'Design de sobrancelha com henna.'),
        service('Design com Tintura', 4500, '1 h', 'brow-tint', 'Design de sobrancelha com tintura.'),
        service('Design de Sobrancelha', 3500, '30 min', 'brow-design', 'Design com pinça, sem coloração.'),
        service('Microblading Fio a Fio', 45000, '2 h', 'microblading', 'Micropigmentação fio a fio.'),
        service('Retoque de Microblading', 20000, '2 h', 'microblading-touch-up', 'Retoque da micropigmentação.')
      ]
    }
  ]
};
