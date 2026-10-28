import type { MenuCategory, MenuGroup, MenuProduct } from './queries';

import { useQuery } from '@tanstack/react-query';

import { getPublic } from './api';

export type PaymentMethod = 'pix' | 'card' | 'cash' | 'voucher';

export type StorefrontStore = {
  name: string;
  slug: string;
  /**
   * The hours say open and the store is accepting orders.
   */
  open: boolean;
  closes_at: string | null;
  delivery_from_cents: number | null;
  min_order_cents: number | null;
  payment_methods: PaymentMethod[];
  delivery_mode: 'flat' | 'by_zone' | 'by_distance';
};

export type StorefrontProduct = Omit<MenuProduct, 'category_id' | 'active'>;

export type StorefrontCategory = Omit<MenuCategory, 'products'> & {
  products: StorefrontProduct[];
};

export type Storefront = {
  store: StorefrontStore;
  categories: StorefrontCategory[];
};

/**
 * Public menu of a store (no login). A 404 means unknown or inactive slug.
 */
export const useStorefront = (slug: string) =>
  useQuery({
    queryKey: ['storefront', slug],
    queryFn: () => getPublic<Storefront>(`/public/stores/${encodeURIComponent(slug)}`),
    retry: false
  });

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  voucher: 'Vale-refeição/alimentação'
};

const options = (count: number) => `${count} ${count === 1 ? 'opção' : 'opções'}`;

/**
 * How many options the customer picks, e.g. "Escolha de 1 a 2 opções · cobra o mais caro".
 */
export const groupRule = ({ min, max, price_mode }: Pick<MenuGroup, 'min' | 'max' | 'price_mode'>) => {
  const rule =
    min === 0
      ? `Escolha até ${options(max)}`
      : min === max
        ? `Escolha ${options(min)}`
        : `Escolha de ${min} a ${max} opções`;

  return price_mode === 'max' && max > 1 ? `${rule} · cobra o mais caro` : rule;
};

/**
 * Accent- and case-insensitive text for the menu search.
 */
export const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
