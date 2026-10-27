export const enum StockUnit {
  Unit = 'un',
  Gram = 'g',
  Milliliter = 'ml'
}

export const enum StockFilter {
  All = 'all',
  Low = 'low',
  SoldOut = 'sold_out',
  Archived = 'archived'
}

/**
 * Stock consumed by one unit of an order line.
 */
export type StockUsage = { stock_item_id: string; qty: number }[];

export type LinkTarget = { productId: string } | { optionId: string };

/**
 * A demo menu's stock item (`MenuImport.stock`): the opening balance enters as one purchase at this unit cost.
 */
export type DemoStockItem = {
  name: string;
  unit: StockUnit;
  min_qty: number | null;
  balance: number;
  /** Millicents per base unit. */
  unit_cost_millicents: number;
  packages?: { name: string; factor: number }[];
};

/**
 * Stock one unit of a demo product or option takes, by item name, in the item's base unit.
 */
export type DemoStockLink = { item: string; qty: number };

export const enum StockMovementKind {
  Sale = 'sale',
  SaleReturn = 'sale_return',
  Purchase = 'purchase',
  Loss = 'loss',
  Count = 'count'
}

export const enum LossReason {
  Breakage = 'breakage',
  Expired = 'expired',
  InternalUse = 'internal_use',
  Other = 'other'
}
