import type { DbClient } from '../db';
import type { DemoStockItem, DemoStockLink, LinkTarget, StockUnit, StockUsage } from './types';
import type { StockItemInput, StockPackageInput } from './validation';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { averageCost } from './cost';
import { LossReason, StockFilter, StockMovementKind } from './types';
import { mergeUsage, soldOutTargets } from './usage';
import { StockError, validateItem, validatePackages } from './validation';

export type StockItemView = {
  id: string;
  name: string;
  unit: StockUnit;
  barcode: string | null;
  balance: number;
  minQty: number | null;
  avgCostMillicents: number | null;
  archivedAt: string | null;
  low: boolean;
};

export type StockPackageView = {
  id: string;
  name: string;
  factor: number;
  barcode: string | null;
};

type ItemRow = {
  id: string;
  name: string;
  unit: StockUnit;
  barcode?: string | null;
  balance: number;
  min_qty?: number | null;
  avg_cost_millicents?: number | null;
  archived_at?: string | null;
};

type PackageRow = {
  id: string;
  name: string;
  factor: number;
  barcode?: string | null;
};

const ITEM_SELECT = {
  id: true,
  name: true,
  unit: true,
  barcode: true,
  balance: true,
  min_qty: true,
  avg_cost_millicents: true,
  archived_at: true
} as const;

const toItemView = (row: ItemRow): StockItemView => ({
  id: row.id,
  name: row.name,
  unit: row.unit,
  barcode: row.barcode ?? null,
  balance: row.balance,
  minQty: row.min_qty ?? null,
  avgCostMillicents: row.avg_cost_millicents ?? null,
  archivedAt: row.archived_at ?? null,
  low: row.min_qty != null && row.balance <= row.min_qty
});

const toPackageView = (row: PackageRow): StockPackageView => ({
  id: row.id,
  name: row.name,
  factor: row.factor,
  barcode: row.barcode ?? null
});

/**
 * A barcode is unique across the store's items and packages. `itemId` is the item being saved (its own code and its
 * packages' codes do not clash with it), `packageIds` the packages being kept.
 */
const assertBarcodeFree = async (
  db: DbClient,
  storeId: string,
  barcode: string | null,
  ignore: { itemId?: string; packageIds?: string[] } = {}
) => {
  if (!barcode) {
    return;
  }

  const [items, packages] = await Promise.all([
    db.stock_items.findMany({ select: { id: true }, where: { store_id: storeId, barcode } }),
    db.stock_packages.findMany({ select: { id: true }, where: { store_id: storeId, barcode } })
  ]);

  const taken =
    items.records.some(({ id }) => id !== ignore.itemId) ||
    packages.records.some(({ id }) => !ignore.packageIds?.includes(id));

  if (taken) {
    throw new StockError('barcode', 'This barcode is already used by another item or package.');
  }
};

const findStoreItem = async (db: DbClient, storeId: string, itemId: string) => {
  const row = await db.stock_items.findOne({ select: { ...ITEM_SELECT, store_id: true }, where: { id: itemId } });

  return row?.store_id === storeId ? row : undefined;
};

const hasMovementsOrLinks = async (db: DbClient, itemId: string) => {
  const movements = await db.stock_movements.findMany({
    select: { id: true },
    where: { stock_item_id: itemId },
    take: 1
  });

  if (movements.records.length) {
    return true;
  }

  const links = await db.stock_links.findMany({ select: { id: true }, where: { stock_item_id: itemId }, take: 1 });

  return links.records.length > 0;
};

export type StockMovementView = {
  id: string;
  kind: StockMovementKind;
  qtyDelta: number;
  balanceAfter: number;
  unitCostMillicents: number | null;
  orderId: string | null;
  reason: string | null;
  note: string | null;
  author: string;
  createdAt: string;
};

/**
 * What an item is linked to: exactly one of `productId`/`optionId` is set, `name` is that product's or option's.
 */
export type StockItemLinkView = {
  productId: string | null;
  optionId: string | null;
  name: string;
  qty: number;
};

const MAX_LINKS_PER_TARGET = 10;

const MAX_NOTE_LENGTH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_MOVEMENTS_PAGE = 50;

const MAX_MOVEMENTS_PAGE = 100;

const DEMO_STOCK_AUTHOR = 'demo';

export type StockMove = {
  itemId: string;
  delta: number;
  kind: StockMovementKind;
  orderId?: string;
  reason?: string;
  note?: string;
  /** Millicents per base unit; on a purchase it feeds the item's average cost. */
  unitCost?: number;
  author: string;
};

/**
 * The only writer of stock balances. `tx` must be a transaction: each touched item is locked (ascending id order, so
 * two callers never deadlock), every move changes its balance in the order given and leaves a movement row with the
 * balance it produced. An item of another store or archived throws `StockError('item')` before anything is written
 * for it; the caller's transaction rolls the rest back. `allowArchived`: an order's own stock coming back or going
 * out by usage frozen before the item was archived (`syncOrderStock` only).
 */
export const applyMovements = async (
  tx: DbClient,
  storeId: string,
  moves: StockMove[],
  options: { allowArchived?: boolean } = {}
) => {
  const itemIds = [...new Set(moves.map(({ itemId }) => itemId))].sort();

  for (const itemId of itemIds) {
    const item = await tx.stock_items.findOne({
      select: { store_id: true, balance: true, avg_cost_millicents: true, archived_at: true },
      where: { id: itemId },
      lock: true
    });

    if (!item || item.store_id !== storeId || (item.archived_at && !options.allowArchived)) {
      throw new StockError('item', 'Item not found.');
    }

    let balance = item.balance;
    let avg = item.avg_cost_millicents ?? null;

    for (const move of moves.filter((entry) => entry.itemId === itemId)) {
      if (move.kind === StockMovementKind.Purchase && move.unitCost !== undefined) {
        avg = averageCost({ balance, avg, qty: move.delta, unitCost: move.unitCost });
      }

      balance += move.delta;

      await tx.stock_movements.insertOne({
        data: {
          id: randomUUID(),
          store_id: storeId,
          stock_item_id: itemId,
          kind: move.kind,
          qty_delta: move.delta,
          balance_after: balance,
          unit_cost_millicents: move.unitCost ?? null,
          order_id: move.orderId ?? null,
          reason: move.reason ?? null,
          note: move.note ?? null,
          author: move.author,
          created_at: new Date().toISOString()
        }
      });
    }

    await tx.stock_items.updateOne({
      data: { balance, avg_cost_millicents: avg, updated_at: new Date().toISOString() },
      where: { id: itemId }
    });
  }
};

const parseCursor = (value: string) => {
  const [createdAt, id, ...rest] = value.split('_');

  if (!createdAt || !id || rest.length || Number.isNaN(Date.parse(createdAt)) || !UUID_PATTERN.test(id)) {
    throw new StockError('before', 'Invalid cursor.');
  }

  return { createdAt, id };
};

const validateQty = (qty: number) => {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new StockError('qty', 'Quantity must be a whole number of at least 1.');
  }
};

const validateNote = (note: string | undefined) => {
  const value = note?.trim() || undefined;

  if (value && value.length > MAX_NOTE_LENGTH) {
    throw new StockError('note', `Note must have up to ${MAX_NOTE_LENGTH} characters.`);
  }

  return value;
};

type PackagePlan = {
  rows: { id: string; store_id: string; stock_item_id: string; name: string; factor: number; barcode: string | null }[];
  currentIds: string[];
  keptIds: string[];
};

/**
 * Validates the packages and checks every barcode before any write, so a clash leaves the item untouched.
 */
const planPackages = async (
  db: DbClient,
  storeId: string,
  itemId: string,
  itemBarcode: string | null | undefined,
  packages: StockPackageInput[]
): Promise<PackagePlan> => {
  const valid = validatePackages(packages);

  if (itemBarcode && valid.some(({ barcode }) => barcode === itemBarcode)) {
    throw new StockError('barcode', 'This barcode is already used by another item or package.');
  }

  const { records: current } = await db.stock_packages.findMany({
    select: { id: true },
    where: { stock_item_id: itemId }
  });

  const currentIds = current.map(({ id }) => id);
  const keptIds = valid.flatMap(({ id }) => (id && currentIds.includes(id) ? [id] : []));

  for (const { barcode } of valid) {
    await assertBarcodeFree(db, storeId, barcode, {
      ...(itemBarcode !== undefined && { itemId }),
      packageIds: keptIds
    });
  }

  const rows = valid.map((item) => ({
    id: item.id && currentIds.includes(item.id) ? item.id : randomUUID(),
    store_id: storeId,
    stock_item_id: itemId,
    name: item.name,
    factor: item.factor,
    barcode: item.barcode
  }));

  return { rows, currentIds, keptIds };
};

const writePackages = async (tx: DbClient, { rows, currentIds, keptIds }: PackagePlan) => {
  for (const id of currentIds) {
    if (!keptIds.includes(id)) {
      await tx.stock_packages.deleteOne({ where: { id } });
    }
  }

  for (const row of rows) {
    if (keptIds.includes(row.id)) {
      await tx.stock_packages.updateOne({
        data: { name: row.name, factor: row.factor, barcode: row.barcode },
        where: { id: row.id }
      });
    } else {
      await tx.stock_packages.insertOne({ data: row });
    }
  }
};

export namespace StockRepository {
  /**
   * Creates the item and its packages in one transaction; a package barcode clash writes nothing.
   */
  export const createItem = async (
    db: DbClient,
    storeId: string,
    input: StockItemInput,
    packages: StockPackageInput[] = []
  ) => {
    const valid = validateItem(input);

    await assertBarcodeFree(db, storeId, valid.barcode);

    const now = new Date().toISOString();
    const id = randomUUID();

    const plan = await planPackages(db, storeId, id, valid.barcode, packages);

    await db.transaction(async (tx) => {
      await tx.stock_items.insertOne({
        data: {
          id,
          store_id: storeId,
          name: valid.name,
          unit: valid.unit,
          barcode: valid.barcode,
          balance: 0,
          min_qty: valid.minQty,
          created_at: now,
          updated_at: now
        }
      });

      await writePackages(tx, plan);
    });

    return toItemView({
      id,
      name: valid.name,
      unit: valid.unit,
      barcode: valid.barcode,
      balance: 0,
      min_qty: valid.minQty
    });
  };

  /**
   * Updates the item; with `packages` it also replaces them, in the same transaction (a clash writes nothing).
   */
  export const updateItem = async (
    db: DbClient,
    storeId: string,
    itemId: string,
    input: StockItemInput,
    packages?: StockPackageInput[]
  ) => {
    const valid = validateItem(input);

    const current = await findStoreItem(db, storeId, itemId);

    if (!current) {
      return undefined;
    }

    // A new unit would reinterpret the balance, the movements and the links already written.
    if (valid.unit !== current.unit && (await hasMovementsOrLinks(db, itemId))) {
      throw new StockError('unit', 'The unit cannot change once the item has movements or links.');
    }

    await assertBarcodeFree(db, storeId, valid.barcode, { itemId });

    const plan = packages && (await planPackages(db, storeId, itemId, valid.barcode, packages));

    await db.transaction(async (tx) => {
      await tx.stock_items.updateOne({
        data: {
          name: valid.name,
          unit: valid.unit,
          barcode: valid.barcode,
          min_qty: valid.minQty,
          updated_at: new Date().toISOString()
        },
        where: { id: itemId }
      });

      if (plan) {
        await writePackages(tx, plan);
      }
    });

    const row = await findStoreItem(db, storeId, itemId);

    return row && toItemView(row);
  };

  /**
   * Replaces the item's packages in one transaction, keeping the ids it was sent (when they belong to the item).
   */
  export const replacePackages = async (
    db: DbClient,
    storeId: string,
    itemId: string,
    packages: StockPackageInput[]
  ): Promise<StockPackageView[]> => {
    if (!(await findStoreItem(db, storeId, itemId))) {
      throw new StockError('item', 'Item not found.');
    }

    const plan = await planPackages(db, storeId, itemId, undefined, packages);

    await db.transaction(async (tx) => {
      await writePackages(tx, plan);
    });

    return plan.rows.map(toPackageView);
  };

  /**
   * Archives the item (it keeps its movements). Returns false when the store has no such item.
   */
  export const archiveItem = async (db: DbClient, storeId: string, itemId: string) => {
    if (!(await findStoreItem(db, storeId, itemId))) {
      return false;
    }

    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx.stock_links.deleteMany({ where: { stock_item_id: itemId } });
      await tx.stock_items.updateOne({ data: { archived_at: now, updated_at: now }, where: { id: itemId } });
    });

    return true;
  };

  /**
   * The item with its packages, or undefined when the store has no such item.
   */
  export const getItem = async (db: DbClient, storeId: string, itemId: string) => {
    const row = await findStoreItem(db, storeId, itemId);

    if (!row) {
      return undefined;
    }

    const { records } = await db.stock_packages.findMany({
      select: { id: true, name: true, factor: true, barcode: true },
      where: { stock_item_id: itemId }
    });

    return {
      item: toItemView(row),
      packages: records.map(toPackageView).sort((a, b) => a.factor - b.factor || a.name.localeCompare(b.name))
    };
  };

  /**
   * Products and options that consume the item, with their names.
   */
  export const linksOfItem = async (db: DbClient, storeId: string, itemId: string): Promise<StockItemLinkView[]> => {
    const { records } = await db.stock_links.findMany({
      select: { product_id: true, option_id: true, qty: true },
      where: { store_id: storeId, stock_item_id: itemId }
    });

    const views: StockItemLinkView[] = [];

    for (const { product_id, option_id, qty } of records) {
      const target = product_id
        ? await db.products.findOne({ select: { name: true }, where: { id: product_id } })
        : option_id
          ? await db.options.findOne({ select: { name: true }, where: { id: option_id } })
          : undefined;

      if (target) {
        views.push({ productId: product_id ?? null, optionId: option_id ?? null, name: target.name, qty });
      }
    }

    return views.sort((a, b) => a.name.localeCompare(b.name));
  };

  export const listItems = async (db: DbClient, storeId: string, filter: StockFilter) => {
    const { records } = await db.stock_items.findMany({
      select: ITEM_SELECT,
      where: {
        store_id: storeId,
        archived_at: filter === StockFilter.Archived ? { isNull: false } : { isNull: true },
        ...(filter === StockFilter.SoldOut && { balance: { lte: 0 } })
      }
    });

    return records
      .map(toItemView)
      .filter((item) => (filter === StockFilter.Low ? item.low : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  /**
   * Stock entry (purchase). With a package, the base quantity is `qty × factor`; the total cost, when sent, becomes
   * the unit cost that updates the item's average.
   */
  export const recordEntry = async (
    db: DbClient,
    storeId: string,
    input: { itemId: string; packageId?: string; qty: number; totalCostCents?: number; author: string }
  ) => {
    validateQty(input.qty);

    if (input.totalCostCents !== undefined && (!Number.isInteger(input.totalCostCents) || input.totalCostCents < 0)) {
      throw new StockError('total_cost', 'Cost must be a whole number of cents, zero or more.');
    }

    let factor = 1;

    if (input.packageId) {
      const pack = await db.stock_packages.findOne({
        select: { store_id: true, stock_item_id: true, factor: true },
        where: { id: input.packageId }
      });

      if (!pack || pack.store_id !== storeId || pack.stock_item_id !== input.itemId) {
        throw new StockError('package', 'Package not found.');
      }

      factor = pack.factor;
    }

    const baseQty = input.qty * factor;

    await db.transaction(async (tx) => {
      await applyMovements(tx, storeId, [
        {
          itemId: input.itemId,
          delta: baseQty,
          kind: StockMovementKind.Purchase,
          ...(input.totalCostCents !== undefined && {
            unitCost: Math.round((input.totalCostCents * 1000) / baseQty)
          }),
          author: input.author
        }
      ]);
    });
  };

  export const recordLoss = async (
    db: DbClient,
    storeId: string,
    input: { itemId: string; qty: number; reason: LossReason; note?: string; author: string }
  ) => {
    validateQty(input.qty);

    if (![LossReason.Breakage, LossReason.Expired, LossReason.InternalUse, LossReason.Other].includes(input.reason)) {
      throw new StockError('reason', 'Unknown reason.');
    }

    const note = validateNote(input.note);

    if (input.reason === LossReason.Other && !note) {
      throw new StockError('note', 'Describe the loss.');
    }

    await db.transaction(async (tx) => {
      await applyMovements(tx, storeId, [
        {
          itemId: input.itemId,
          delta: -input.qty,
          kind: StockMovementKind.Loss,
          reason: input.reason,
          ...(note && { note }),
          author: input.author
        }
      ]);
    });
  };

  /**
   * Counted balances. A `count` movement is written only where the count differs from the balance read under lock.
   */
  export const recordCounts = async (
    db: DbClient,
    storeId: string,
    counts: { itemId: string; counted: number }[],
    author: string
  ) => {
    for (const { counted } of counts) {
      if (!Number.isInteger(counted) || counted < 0) {
        throw new StockError('qty', 'Count must be a whole number, zero or more.');
      }
    }

    if (new Set(counts.map(({ itemId }) => itemId)).size !== counts.length) {
      throw new StockError('item', 'The same item cannot be counted twice.');
    }

    await db.transaction(async (tx) => {
      const moves: StockMove[] = [];

      for (const { itemId, counted } of [...counts].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
        const item = await tx.stock_items.findOne({
          select: { store_id: true, balance: true, archived_at: true },
          where: { id: itemId },
          lock: true
        });

        if (!item || item.store_id !== storeId || item.archived_at) {
          throw new StockError('item', 'Item not found.');
        }

        if (counted !== item.balance) {
          moves.push({ itemId, delta: counted - item.balance, kind: StockMovementKind.Count, author });
        }
      }

      await applyMovements(tx, storeId, moves);
    });
  };

  /**
   * Movements of an item, newest first (`created_at`, then `id`, both descending, so rows sharing a timestamp keep a
   * stable order). `next` is an opaque cursor for the following page (`before`), null on the last one.
   */
  export const listMovements = async (
    db: DbClient,
    storeId: string,
    itemId: string,
    page: { before?: string; limit?: number }
  ) => {
    const limit = Math.min(Math.max(Math.trunc(page.limit ?? DEFAULT_MOVEMENTS_PAGE), 1), MAX_MOVEMENTS_PAGE);

    const cursor = page.before === undefined ? undefined : parseCursor(page.before);

    const { records: found } = await db.stock_movements.findMany({
      select: {
        id: true,
        kind: true,
        qty_delta: true,
        balance_after: true,
        unit_cost_millicents: true,
        order_id: true,
        reason: true,
        note: true,
        author: true,
        created_at: true
      },
      where: {
        store_id: storeId,
        stock_item_id: itemId,
        ...(cursor && {
          OR: [{ created_at: { lt: cursor.createdAt } }, { created_at: cursor.createdAt, id: { lt: cursor.id } }]
        })
      },
      order: { created_at: Order.Desc, id: Order.Desc },
      take: limit + 1
    });

    const records = found.slice(0, limit);
    const last = records[records.length - 1];

    const movements: StockMovementView[] = records.map((row) => ({
      id: row.id,
      kind: row.kind,
      qtyDelta: row.qty_delta,
      balanceAfter: row.balance_after,
      unitCostMillicents: row.unit_cost_millicents ?? null,
      orderId: row.order_id ?? null,
      reason: row.reason ?? null,
      note: row.note ?? null,
      author: row.author,
      createdAt: row.created_at
    }));

    return {
      movements,
      next: found.length > limit && last ? `${last.created_at}_${last.id}` : null
    };
  };

  export const findByBarcode = async (db: DbClient, storeId: string, code: string) => {
    const barcode = code.trim();

    const { records: items } = await db.stock_items.findMany({
      select: ITEM_SELECT,
      take: 1,
      where: { store_id: storeId, barcode }
    });

    if (items[0]) {
      return { item: toItemView(items[0]) };
    }

    const { records: packages } = await db.stock_packages.findMany({
      select: { id: true, stock_item_id: true, name: true, factor: true, barcode: true },
      take: 1,
      where: { store_id: storeId, barcode }
    });

    const found = packages[0];
    const row = found && (await findStoreItem(db, storeId, found.stock_item_id));

    return found && row ? { item: toItemView(row), package: toPackageView(found) } : undefined;
  };

  /**
   * Targets that consume exactly `qty` of the item per unit sold (what a scan of that item or package stands for).
   */
  export const linksForQty = async (db: DbClient, storeId: string, stockItemId: string, qty: number) => {
    const { records } = await db.stock_links.findMany({
      select: { product_id: true, option_id: true },
      where: { store_id: storeId, stock_item_id: stockItemId, qty }
    });

    return records.map((link) => ({ productId: link.product_id ?? null, optionId: link.option_id ?? null }));
  };

  const targetWhere = (target: LinkTarget) =>
    'productId' in target ? { product_id: target.productId } : { option_id: target.optionId };

  const targetBelongsToStore = async (db: DbClient, storeId: string, target: LinkTarget) => {
    if ('productId' in target) {
      const product = await db.products.findOne({ select: { store_id: true }, where: { id: target.productId } });

      return product?.store_id === storeId;
    }

    const option = await db.options.findOne({ select: { store_id: true }, where: { id: target.optionId } });

    return option?.store_id === storeId;
  };

  /**
   * Replaces the target's links in one transaction. The target and the items must be the store's, and the items active.
   */
  export const setLinks = async (
    db: DbClient,
    storeId: string,
    target: LinkTarget,
    links: { stockItemId: string; qty: number }[]
  ) => {
    if (links.length > MAX_LINKS_PER_TARGET) {
      throw new StockError('links', `At most ${MAX_LINKS_PER_TARGET} items per product or option.`);
    }

    if (!(await targetBelongsToStore(db, storeId, target))) {
      throw new StockError('links', 'Product or option not found.');
    }

    const itemIds = links.map(({ stockItemId }) => stockItemId);

    if (new Set(itemIds).size !== itemIds.length) {
      throw new StockError('links', 'The same item cannot be linked twice.');
    }

    for (const { qty } of links) {
      if (!Number.isInteger(qty) || qty < 1) {
        throw new StockError('links', 'Quantity must be a whole number of at least 1.');
      }
    }

    for (const stockItemId of itemIds) {
      const item = await findStoreItem(db, storeId, stockItemId);

      if (!item || item.archived_at) {
        throw new StockError('links', 'Item not found.');
      }
    }

    await db.transaction(async (tx) => {
      await tx.stock_links.deleteMany({ where: targetWhere(target) });

      for (const { stockItemId, qty } of links) {
        await tx.stock_links.insertOne({
          data: { id: randomUUID(), store_id: storeId, stock_item_id: stockItemId, ...targetWhere(target), qty }
        });
      }
    });
  };

  export const linksFor = async (db: DbClient, storeId: string, target: LinkTarget) => {
    const { records } = await db.stock_links.findMany({
      select: { stock_item_id: true, qty: true },
      where: { store_id: storeId, ...targetWhere(target) }
    });

    const views = [];

    for (const { stock_item_id, qty } of records) {
      const item = await findStoreItem(db, storeId, stock_item_id);

      if (item) {
        views.push({ stockItemId: item.id, name: item.name, unit: item.unit, qty });
      }
    }

    return views.sort((a, b) => a.name.localeCompare(b.name));
  };

  /**
   * Links of a product and of each of its options (through its groups), or undefined when the product is not the
   * store's. Three links/item queries in all, however many options.
   */
  export const linksOfProduct = async (db: DbClient, storeId: string, productId: string) => {
    if (!(await targetBelongsToStore(db, storeId, { productId }))) {
      return undefined;
    }

    const { records: groupLinks } = await db.product_groups.findMany({
      select: { group_id: true },
      where: { store_id: storeId, product_id: productId }
    });

    const groupIds = groupLinks.map(({ group_id }) => group_id);

    const { records: options } = groupIds.length
      ? await db.options.findMany({
          select: { id: true },
          where: { store_id: storeId, group_id: { isIn: groupIds } }
        })
      : { records: [] };

    const optionIds = options.map(({ id }) => id);

    const { records: links } = await db.stock_links.findMany({
      select: { stock_item_id: true, product_id: true, option_id: true, qty: true },
      where: {
        store_id: storeId,
        OR: [{ product_id: productId }, ...(optionIds.length ? [{ option_id: { isIn: optionIds } }] : [])]
      }
    });

    const { records: items } = links.length
      ? await db.stock_items.findMany({
          select: { id: true, name: true, unit: true },
          where: { store_id: storeId, id: { isIn: [...new Set(links.map(({ stock_item_id }) => stock_item_id))] } }
        })
      : { records: [] };

    const byId = new Map(items.map((item) => [item.id, item]));

    const viewOf = (list: typeof links) =>
      list
        .flatMap(({ stock_item_id, qty }) => {
          const item = byId.get(stock_item_id);

          return item ? [{ stockItemId: item.id, name: item.name, unit: item.unit, qty }] : [];
        })
        .sort((x, y) => x.name.localeCompare(y.name));

    return {
      product: viewOf(links.filter((link) => link.product_id === productId)),
      options: optionIds.map((optionId) => ({
        optionId,
        links: viewOf(links.filter((link) => link.option_id === optionId))
      }))
    };
  };

  /**
   * Stock one unit of the line consumes: the product's links plus those of its chosen options.
   */
  export const usageFor = async (
    db: DbClient,
    storeId: string,
    input: { productId: string; optionIds: string[] }
  ): Promise<StockUsage> => {
    const { records } = await db.stock_links.findMany({
      select: { stock_item_id: true, qty: true },
      where: {
        store_id: storeId,
        OR: [
          { product_id: input.productId },
          ...(input.optionIds.length ? [{ option_id: { isIn: input.optionIds } }] : [])
        ]
      }
    });

    return mergeUsage(records.map(({ stock_item_id, qty }) => [{ stock_item_id, qty }]));
  };

  /**
   * Products and options whose linked items do not cover one unit. Archived items have no links.
   */
  /**
   * Demo stock (`importMenu` only): items, packages, the opening balance as a purchase and the links by item name, in
   * one transaction. Active items named like a demo item are archived first, so loading the demo again never
   * duplicates them.
   */
  export const importDemoStock = async (
    db: DbClient,
    storeId: string,
    items: DemoStockItem[],
    links: { target: LinkTarget; stock: DemoStockLink[] }[]
  ) => {
    const now = new Date().toISOString();
    const ids = new Map(items.map(({ name }) => [name, randomUUID()]));

    await db.transaction(async (tx) => {
      const { records: current } = await tx.stock_items.findMany({
        select: { id: true, name: true },
        where: { store_id: storeId, archived_at: { isNull: true } }
      });

      for (const { id, name } of current) {
        if (ids.has(name)) {
          await tx.stock_links.deleteMany({ where: { stock_item_id: id } });
          await tx.stock_items.updateOne({ data: { archived_at: now, updated_at: now }, where: { id } });
        }
      }

      for (const item of items) {
        const id = ids.get(item.name)!;

        await tx.stock_items.insertOne({
          data: {
            id,
            store_id: storeId,
            name: item.name,
            unit: item.unit,
            barcode: null,
            balance: 0,
            min_qty: item.min_qty,
            created_at: now,
            updated_at: now
          }
        });

        for (const { name, factor } of item.packages ?? []) {
          await tx.stock_packages.insertOne({
            data: { id: randomUUID(), store_id: storeId, stock_item_id: id, name, factor, barcode: null }
          });
        }
      }

      await applyMovements(
        tx,
        storeId,
        items
          .filter(({ balance }) => balance > 0)
          .map((item) => ({
            itemId: ids.get(item.name)!,
            delta: item.balance,
            kind: StockMovementKind.Purchase,
            unitCost: item.unit_cost_millicents,
            author: DEMO_STOCK_AUTHOR
          }))
      );

      for (const { target, stock } of links) {
        for (const { item, qty } of stock) {
          const stockItemId = ids.get(item);

          if (!stockItemId) {
            throw new Error(`Demo stock item not found: ${item}`);
          }

          await tx.stock_links.insertOne({
            data: { id: randomUUID(), store_id: storeId, stock_item_id: stockItemId, ...targetWhere(target), qty }
          });
        }
      }
    });
  };

  export const availability = async (db: DbClient, storeId: string) => {
    const [items, links] = await Promise.all([
      db.stock_items.findMany({
        select: { id: true, balance: true },
        where: { store_id: storeId, archived_at: { isNull: true } }
      }),
      db.stock_links.findMany({
        select: { stock_item_id: true, product_id: true, option_id: true, qty: true },
        where: { store_id: storeId }
      })
    ]);

    return soldOutTargets(links.records, new Map(items.records.map(({ id, balance }) => [id, balance])));
  };
}
