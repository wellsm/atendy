import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { applyMovements, StockRepository } from '../../src/stock/repository';
import { LossReason, StockMovementKind, StockUnit } from '../../src/stock/types';
import { StockError } from '../../src/stock/validation';
import { seedStore } from '../support/fixtures';

const failsOn = (field: string) => (error: unknown) => error instanceof StockError && error.field === field;

const MOVEMENT_SELECT = {
  kind: true,
  qty_delta: true,
  balance_after: true,
  unit_cost_millicents: true,
  reason: true
} as const;

describe('stock movements', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const seedItem = async (name = 'Coca') => {
    const { storeId } = await seedStore(db);
    const item = await StockRepository.createItem(db, storeId, {
      name,
      unit: StockUnit.Unit,
      barcode: null,
      minQty: null
    });
    const [pack] = await StockRepository.replacePackages(db, storeId, item.id, [
      { name: 'Fardo 12', factor: 12, barcode: null }
    ]);

    return { storeId, itemId: item.id, packageId: pack!.id };
  };

  const itemRow = (id: string) =>
    db.stock_items.findOne({ select: { balance: true, avg_cost_millicents: true }, where: { id } });

  it('records an entry by package with the average cost', async () => {
    const { storeId, itemId, packageId } = await seedItem();

    await StockRepository.recordEntry(db, storeId, { itemId, packageId, qty: 2, totalCostCents: 4800, author: 'u1' });

    const row = await itemRow(itemId);

    equal(row?.balance, 24);
    equal(row?.avg_cost_millicents, 200000);

    const { records } = await db.stock_movements.findMany({
      select: MOVEMENT_SELECT,
      where: { stock_item_id: itemId }
    });

    equal(records.length, 1);
    equal(records[0]!.kind, StockMovementKind.Purchase);
    equal(records[0]!.qty_delta, 24);
    equal(records[0]!.balance_after, 24);
    equal(records[0]!.unit_cost_millicents, 200000);
  });

  it('keeps the average when an entry has no cost', async () => {
    const { storeId, itemId } = await seedItem();

    await StockRepository.recordEntry(db, storeId, { itemId, qty: 10, totalCostCents: 1000, author: 'u1' });
    await StockRepository.recordEntry(db, storeId, { itemId, qty: 5, author: 'u1' });

    const row = await itemRow(itemId);

    equal(row?.balance, 15);
    equal(row?.avg_cost_millicents, 100000);
  });

  it('records a loss', async () => {
    const { storeId, itemId, packageId } = await seedItem();

    await StockRepository.recordEntry(db, storeId, { itemId, packageId, qty: 2, author: 'u1' });
    await StockRepository.recordLoss(db, storeId, { itemId, qty: 1, reason: LossReason.Breakage, author: 'u1' });

    equal((await itemRow(itemId))?.balance, 23);

    const { records } = await db.stock_movements.findMany({
      select: MOVEMENT_SELECT,
      where: { stock_item_id: itemId, kind: StockMovementKind.Loss }
    });

    equal(records[0]!.qty_delta, -1);
    equal(records[0]!.reason, 'breakage');
    equal(records[0]!.balance_after, 23);
  });

  it('records counts only where they differ', async () => {
    const { storeId, itemId, packageId } = await seedItem();

    await StockRepository.recordEntry(db, storeId, { itemId, packageId, qty: 2, author: 'u1' });
    await StockRepository.recordLoss(db, storeId, { itemId, qty: 1, reason: LossReason.Expired, author: 'u1' });
    await StockRepository.recordCounts(db, storeId, [{ itemId, counted: 20 }], 'u1');

    equal((await itemRow(itemId))?.balance, 20);

    const { records } = await db.stock_movements.findMany({
      select: MOVEMENT_SELECT,
      where: { stock_item_id: itemId, kind: StockMovementKind.Count }
    });

    equal(records.length, 1);
    equal(records[0]!.qty_delta, -3);
    equal(records[0]!.balance_after, 20);

    await StockRepository.recordCounts(db, storeId, [{ itemId, counted: 20 }], 'u1');

    equal(
      (await db.stock_movements.findMany({ select: MOVEMENT_SELECT, where: { stock_item_id: itemId } })).records.length,
      3
    );
  });

  it('validates quantities, notes and packages', async () => {
    const { storeId, itemId } = await seedItem();
    const other = await seedItem('Guaraná');

    await rejects(StockRepository.recordEntry(db, storeId, { itemId, qty: 0, author: 'u1' }), failsOn('qty'));
    await rejects(
      StockRepository.recordLoss(db, storeId, { itemId, qty: 1, reason: LossReason.Other, author: 'u1' }),
      failsOn('note')
    );
    await rejects(
      StockRepository.recordLoss(db, storeId, { itemId, qty: 0, reason: LossReason.Breakage, author: 'u1' }),
      failsOn('qty')
    );
    await rejects(
      StockRepository.recordEntry(db, storeId, { itemId, packageId: other.packageId, qty: 1, author: 'u1' }),
      failsOn('package')
    );
    await rejects(StockRepository.recordCounts(db, storeId, [{ itemId, counted: -1 }], 'u1'), failsOn('qty'));
  });

  it('refuses items of another store or archived, writing nothing', async () => {
    const { storeId, itemId } = await seedItem();
    const other = await seedItem('Guaraná');

    await rejects(
      StockRepository.recordEntry(db, storeId, { itemId: other.itemId, qty: 1, author: 'u1' }),
      failsOn('item')
    );

    await StockRepository.archiveItem(db, storeId, itemId);

    await rejects(StockRepository.recordEntry(db, storeId, { itemId, qty: 1, author: 'u1' }), failsOn('item'));
    equal(
      (await db.stock_movements.findMany({ select: MOVEMENT_SELECT, where: { stock_item_id: itemId } })).records.length,
      0
    );
  });

  it('pages movements with tied timestamps, each row exactly once', async () => {
    const { storeId, itemId } = await seedItem();

    await db.transaction((tx) =>
      applyMovements(
        tx,
        storeId,
        [1, 2, 3, 4, 5].map((delta) => ({ itemId, delta, kind: StockMovementKind.Purchase, author: 'u1' }))
      )
    );

    await StockRepository.recordEntry(db, storeId, { itemId, qty: 6, author: 'u1' });

    const seen: number[] = [];
    let before: string | undefined;

    do {
      const page = await StockRepository.listMovements(db, storeId, itemId, { before, limit: 2 });

      equal(page.movements.length <= 2, true);
      seen.push(...page.movements.map((m) => m.qtyDelta));
      before = page.next ?? undefined;
    } while (before);

    deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
    equal(seen[0], 6);
    equal((await StockRepository.listMovements(db, storeId, itemId, {})).next, null);
  });

  it('refuses an unparsable cursor', async () => {
    const { storeId, itemId } = await seedItem();

    await rejects(StockRepository.listMovements(db, storeId, itemId, { before: 'nope' }), failsOn('before'));
  });

  describe('applyMovements', () => {
    const run = (storeId: string, moves: Parameters<typeof applyMovements>[2]) =>
      db.transaction((tx) => applyMovements(tx, storeId, moves));

    it('sequences balance_after per item across several items', async () => {
      const { storeId, itemId } = await seedItem();
      const second = await StockRepository.createItem(db, storeId, {
        name: 'Guaraná',
        unit: StockUnit.Unit,
        barcode: null,
        minQty: null
      });

      await run(storeId, [
        { itemId, delta: 10, kind: StockMovementKind.Purchase, author: 'u1' },
        { itemId: second.id, delta: 5, kind: StockMovementKind.Purchase, author: 'u1' },
        { itemId, delta: -3, kind: StockMovementKind.Sale, author: 'u1' },
        { itemId, delta: -9, kind: StockMovementKind.Sale, author: 'u1' }
      ]);

      equal((await itemRow(itemId))?.balance, -2);
      equal((await itemRow(second.id))?.balance, 5);

      const { records } = await db.stock_movements.findMany({
        select: { stock_item_id: true, qty_delta: true, balance_after: true },
        where: { store_id: storeId }
      });

      const afters = (id: string) =>
        records
          .filter((r) => r.stock_item_id === id)
          .sort((a, b) => b.qty_delta - a.qty_delta)
          .map((r) => r.balance_after);

      deepEqual(afters(itemId), [10, 7, -2]);
      deepEqual(afters(second.id), [5]);
    });

    it('rolls everything back when a later move targets an unknown or archived item', async () => {
      const { storeId, itemId } = await seedItem();
      const archived = await StockRepository.createItem(db, storeId, {
        name: 'Velho',
        unit: StockUnit.Unit,
        barcode: null,
        minQty: null
      });

      await StockRepository.archiveItem(db, storeId, archived.id);

      for (const bad of [archived.id, randomUUID()]) {
        await rejects(
          run(storeId, [
            { itemId, delta: 4, kind: StockMovementKind.Purchase, unitCost: 100, author: 'u1' },
            { itemId: bad, delta: 1, kind: StockMovementKind.Purchase, author: 'u1' }
          ]),
          failsOn('item')
        );
      }

      const row = await itemRow(itemId);

      equal(row?.balance, 0);
      equal(row?.avg_cost_millicents ?? null, null);
      equal(
        (await db.stock_movements.findMany({ select: MOVEMENT_SELECT, where: { store_id: storeId } })).records.length,
        0
      );
    });

    it('weights the average on a second purchase with a positive balance', async () => {
      const { storeId, itemId } = await seedItem();

      await run(storeId, [{ itemId, delta: 10, kind: StockMovementKind.Purchase, unitCost: 300000, author: 'u1' }]);
      await run(storeId, [{ itemId, delta: 10, kind: StockMovementKind.Purchase, unitCost: 400000, author: 'u1' }]);

      const row = await itemRow(itemId);

      equal(row?.balance, 20);
      equal(row?.avg_cost_millicents, 350000);
    });
  });
});
