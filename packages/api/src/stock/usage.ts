import type { StockUsage } from './types';

type LinkRow = {
  stock_item_id: string;
  product_id?: string | null;
  option_id?: string | null;
  qty: number;
};

/**
 * Sums the quantity per item across the parts, sorted by item id.
 */
export const mergeUsage = (parts: StockUsage[]): StockUsage => {
  const totals = new Map<string, number>();

  for (const part of parts) {
    for (const { stock_item_id, qty } of part) {
      totals.set(stock_item_id, (totals.get(stock_item_id) ?? 0) + qty);
    }
  }

  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([stock_item_id, qty]) => ({ stock_item_id, qty }));
};

/**
 * A product or option is sold out when any of its links needs more than the item's balance.
 */
export const soldOutTargets = (links: LinkRow[], balances: Map<string, number>) => {
  const soldOutProducts = new Set<string>();
  const soldOutOptions = new Set<string>();

  for (const link of links) {
    if ((balances.get(link.stock_item_id) ?? 0) >= link.qty) {
      continue;
    }

    if (link.product_id) {
      soldOutProducts.add(link.product_id);
    }

    if (link.option_id) {
      soldOutOptions.add(link.option_id);
    }
  }

  return { soldOutProducts, soldOutOptions };
};
