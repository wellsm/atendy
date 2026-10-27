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
