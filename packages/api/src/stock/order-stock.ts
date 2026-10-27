import type { DbClient } from '../db';
import type { StockMove } from './repository';

import { applyMovements } from './repository';
import { StockMovementKind } from './types';
import { OrderError, OrderErrorCode } from '../orders/errors';

const SYSTEM_AUTHOR = 'system';

/**
 * Brings the stock an order holds to what its lines need now: per item, Σ line qty × frozen usage (zero when
 * `canceled`) minus what the order's `sale`/`sale_return` movements already took. The order row must be locked by
 * the caller's transaction (`tx`), so the movements read here cannot change meanwhile; retries and repeated edits
 * write nothing. With `enforce` (bot and web), an increase that the locked balance cannot cover throws
 * `OrderError(OutOfStock)` before anything is written. Archived items still move: the usage was frozen before.
 */
export const syncOrderStock = async (
  tx: DbClient,
  input: { storeId: string; orderId: string; enforce: boolean; canceled?: boolean }
) => {
  const [{ records: lines }, { records: movements }] = await Promise.all([
    tx.order_items.findMany({
      select: { product_name: true, qty: true, options_snapshot: true, stock_usage: true },
      where: { order_id: input.orderId }
    }),
    tx.stock_movements.findMany({
      select: { stock_item_id: true, qty_delta: true },
      where: {
        order_id: input.orderId,
        store_id: input.storeId,
        kind: { isIn: [StockMovementKind.Sale, StockMovementKind.SaleReturn] }
      }
    })
  ]);

  const target = new Map<string, number>();

  if (!input.canceled) {
    for (const line of lines) {
      for (const { stock_item_id, qty } of line.stock_usage ?? []) {
        target.set(stock_item_id, (target.get(stock_item_id) ?? 0) + line.qty * qty);
      }
    }
  }

  const held = new Map<string, number>();

  for (const { stock_item_id, qty_delta } of movements) {
    held.set(stock_item_id, (held.get(stock_item_id) ?? 0) - qty_delta);
  }

  const differences = [...new Set([...target.keys(), ...held.keys()])]
    .sort()
    .map((itemId) => ({ itemId, difference: (target.get(itemId) ?? 0) - (held.get(itemId) ?? 0) }))
    .filter(({ difference }) => difference !== 0);

  if (!differences.length) {
    return;
  }

  if (input.enforce) {
    const short: string[] = [];

    // Locks every touched item in ascending id order (as `applyMovements` does next), so the balance read here is
    // the one the movement changes and two placements of the last unit cannot both pass.
    for (const { itemId, difference } of differences) {
      const item = await tx.stock_items.findOne({ select: { balance: true }, where: { id: itemId }, lock: true });

      if (difference > 0 && (item?.balance ?? 0) < difference) {
        short.push(itemId);
      }
    }

    if (short.length) {
      const names = lines
        .filter(({ stock_usage }) => stock_usage?.some(({ stock_item_id }) => short.includes(stock_item_id)))
        .flatMap(({ product_name, options_snapshot }) => [
          product_name,
          ...options_snapshot.flatMap(({ options }) => options.map(({ name }) => name))
        ]);

      const unique = [...new Set(names)];

      throw new OrderError(OrderErrorCode.OutOfStock, `Out of stock: ${unique.join(', ')}`, undefined, unique);
    }
  }

  const moves: StockMove[] = differences.map(({ itemId, difference }) => ({
    itemId,
    delta: -difference,
    kind: difference > 0 ? StockMovementKind.Sale : StockMovementKind.SaleReturn,
    orderId: input.orderId,
    author: SYSTEM_AUTHOR
  }));

  await applyMovements(tx, input.storeId, moves, { allowArchived: true });
};
