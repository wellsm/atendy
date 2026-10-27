import type { StorefrontProduct } from './storefront';

import { useEffect, useState } from 'react';

import { isAvailable } from './menu';

export type CartSelection = { group_id: string; option_ids: string[] };

export type CartLine = {
  /**
   * Same product, options and notes = same line (its quantity grows).
   */
  key: string;
  product_id: string;
  name: string;
  options: string;
  selections: CartSelection[];
  notes: string | null;
  qty: number;
  /**
   * Shown in the cart; the API prices the order again.
   */
  unit_cents: number;
};

/**
 * Unit price of a product with the chosen options, like the API: each group adds the sum of its deltas, or the most
 * expensive one when it charges the max.
 */
export const unitPrice = (product: StorefrontProduct, chosen: Record<string, string[]>) =>
  product.groups.reduce((total, group) => {
    const deltas = group.options
      .filter(({ id }) => chosen[group.id]?.includes(id))
      .map(({ price_delta_cents }) => price_delta_cents);

    if (!deltas.length) {
      return total;
    }

    return total + (group.price_mode === 'max' ? Math.max(...deltas) : deltas.reduce((sum, delta) => sum + delta, 0));
  }, product.price_cents);

export const optionsText = (product: StorefrontProduct, chosen: Record<string, string[]>) =>
  product.groups
    .map((group) => {
      const names = group.options.filter(({ id }) => chosen[group.id]?.includes(id)).map(({ name }) => name);

      return names.length ? `${group.name}: ${names.join(' / ')}` : '';
    })
    .filter(Boolean)
    .join('; ');

const storageKey = (slug: string) => `atendy:cart:${slug}`;

const read = (slug: string): CartLine[] => {
  try {
    return JSON.parse(localStorage.getItem(storageKey(slug)) ?? '[]') as CartLine[];
  } catch {
    return [];
  }
};

/**
 * The customer's cart for one store, kept in this browser (a reload or a later visit keeps it).
 */
export const useCart = (slug: string) => {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => setLines(read(slug)), [slug]);

  const save = (next: CartLine[]) => {
    setLines(next);

    try {
      localStorage.setItem(storageKey(slug), JSON.stringify(next));
    } catch {
      // Private mode: the cart still works for this visit.
    }
  };

  const addAll = (added: Omit<CartLine, 'key'>[]) =>
    save(
      added.reduce((next, line) => {
        const key = JSON.stringify([line.product_id, line.selections, line.notes]);

        return next.some((current) => current.key === key)
          ? next.map((current) => (current.key === key ? { ...current, qty: current.qty + line.qty } : current))
          : [...next, { ...line, key }];
      }, lines)
    );

  const add = (line: Omit<CartLine, 'key'>) => addAll([line]);

  const setQty = (key: string, qty: number) =>
    save(
      qty > 0
        ? lines.map((line) => (line.key === key ? { ...line, qty } : line))
        : lines.filter((line) => line.key !== key)
    );

  return {
    lines,
    add,
    addAll,
    setQty,
    clear: () => save([]),
    count: lines.reduce((total, { qty }) => total + qty, 0),
    subtotalCents: lines.reduce((total, { qty, unit_cents }) => total + qty * unit_cents, 0)
  };
};

export type Cart = ReturnType<typeof useCart>;

export type PastItem = {
  product_id: string;
  name: string;
  qty: number;
  selections: { group_id: string; option_ids: string[] }[];
  notes: string | null;
};

/**
 * A past order as cart lines at today's prices. An item whose product, options or option rules changed (sold out,
 * removed, a new required choice) is left out and named in `missing`.
 */
export const repeatLines = (items: PastItem[], products: StorefrontProduct[]) => {
  const lines: Omit<CartLine, 'key'>[] = [];
  const missing: string[] = [];

  for (const item of items) {
    const product = products.find(({ id }) => id === item.product_id);
    const chosen = Object.fromEntries(item.selections.map(({ group_id, option_ids }) => [group_id, option_ids]));

    const valid =
      !!product &&
      !product.sold_out &&
      item.selections.every(({ group_id, option_ids }) => {
        const group = product.groups.find(({ id }) => id === group_id);

        return option_ids.every((id) => group?.options.some((option) => option.id === id && isAvailable(option)));
      }) &&
      product.groups.every(({ id, min, max }) => {
        const count = chosen[id]?.length ?? 0;

        return count >= min && count <= max;
      });

    if (!valid) {
      missing.push(item.name);
      continue;
    }

    lines.push({
      product_id: product.id,
      name: product.name,
      options: optionsText(product, chosen),
      selections: item.selections.filter(({ option_ids }) => option_ids.length),
      notes: item.notes,
      qty: item.qty,
      unit_cents: unitPrice(product, chosen)
    });
  }

  return { lines, missing };
};
