import type { DbClient } from '../db';

import { randomUUID } from 'node:crypto';

import { StaffError } from './errors';
import { CashRepository } from '../cash/repository';
import { displayOrderCode } from '../orders/code';
import { OrderStatus } from '../orders/types';
import { StoreRepository } from '../stores/repository';
import { PaymentMethod } from '../stores/types';

export type PendingOrder = {
  id: string;
  code: string;
  deliveredAt: string | null;
  feeCents: number;
  cashCents: number;
};

export type CourierSettlementView = {
  id: string;
  ordersCount: number;
  feesCents: number;
  cashCents: number;
  cashMovementId: string | null;
  settledBy: string;
  createdAt: string;
};

const MAX_ORDERS = 200;

const SETTLEMENTS_PAGE = 50;

const parseTime = (field: string, value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    throw new StaffError(field, 'Invalid date.');
  }

  return time;
};

const findCourier = async (db: DbClient, storeId: string, courierId: string) => {
  const courier = await db.staff.findOne({ select: { id: true, store_id: true }, where: { id: courierId } });

  if (!courier || courier.store_id !== storeId) {
    throw new StaffError('not_found', 'Employee not found.');
  }
};

const toSettlement = (row: {
  id: string;
  orders_count: number;
  fees_cents: number;
  cash_cents: number;
  cash_movement_id?: string | null;
  settled_by: string;
  created_at: string;
}): CourierSettlementView => ({
  id: row.id,
  ordersCount: row.orders_count,
  feesCents: row.fees_cents,
  cashCents: row.cash_cents,
  cashMovementId: row.cash_movement_id ?? null,
  settledBy: row.settled_by,
  createdAt: row.created_at
});

export namespace CourierSettlements {
  /**
   * The courier's `done` orders not settled yet, delivered inside the optional period. An order canceled while `out`
   * is not `done`, so it owes no fee. Net = cash the courier holds − fees the store owes.
   */
  export const pending = async (
    db: DbClient,
    storeId: string,
    courierId: string,
    period: { from?: string; to?: string }
  ) => {
    const from = parseTime('from', period.from);
    const to = parseTime('to', period.to);

    await findCourier(db, storeId, courierId);

    const { records } = await db.orders.findMany({
      select: {
        id: true,
        code: true,
        total_cents: true,
        payment_method: true,
        courier_fee_cents: true,
        delivered_at: true
      },
      where: { store_id: storeId, courier_id: courierId, status: OrderStatus.Done, courier_settlement_id: null }
    });

    const orders = records
      .filter(({ delivered_at }) => {
        const time = delivered_at ? Date.parse(delivered_at) : NaN;

        return (from === undefined || time >= from) && (to === undefined || time <= to);
      })
      .sort((a, b) => (a.delivered_at ?? '').localeCompare(b.delivered_at ?? ''))
      .map((order): PendingOrder => ({
        id: order.id,
        code: displayOrderCode(order),
        deliveredAt: order.delivered_at ?? null,
        feeCents: order.courier_fee_cents ?? 0,
        cashCents: order.payment_method === PaymentMethod.Cash ? order.total_cents : 0
      }));

    const feesCents = orders.reduce((total, { feeCents }) => total + feeCents, 0);
    const cashCents = orders.reduce((total, { cashCents }) => total + cashCents, 0);

    return { orders, feesCents, cashCents, netCents: cashCents - feesCents };
  };

  /**
   * Settles the listed orders in one transaction: they are locked in ascending id and re-checked (the courier's, `done`,
   * unsettled), so two parallel settles pay the fees once (the loser gets `settled`). With cash control on and a
   * session open the fees leave the drawer as a `courier_payout` movement.
   */
  export const settle = async (
    db: DbClient,
    storeId: string,
    courierId: string,
    orderIds: string[],
    author: string
  ) => {
    const ids = [...new Set(orderIds)].sort();

    if (!ids.length || ids.length > MAX_ORDERS) {
      throw new StaffError('order_ids', `Settle 1 to ${MAX_ORDERS} orders.`);
    }

    await findCourier(db, storeId, courierId);

    return db.transaction(async (tx) => {
      let feesCents = 0;
      let cashCents = 0;

      for (const id of ids) {
        const order = await tx.orders.findOne({
          select: {
            store_id: true,
            courier_id: true,
            status: true,
            total_cents: true,
            payment_method: true,
            courier_fee_cents: true,
            courier_settlement_id: true
          },
          where: { id },
          lock: true
        });

        if (
          !order ||
          order.store_id !== storeId ||
          order.courier_id !== courierId ||
          order.status !== OrderStatus.Done
        ) {
          throw new StaffError('order_ids', 'Order is not a delivered order of this courier.');
        }

        if (order.courier_settlement_id) {
          throw new StaffError('settled', 'Order already settled.');
        }

        feesCents += order.courier_fee_cents ?? 0;
        cashCents += order.payment_method === PaymentMethod.Cash ? order.total_cents : 0;
      }

      const movementId = (await StoreRepository.getPosSettings(tx, storeId)).cashControl
        ? await CashRepository.recordCourierPayout(tx, storeId, {
            amountCents: feesCents,
            author,
            reason: 'Acerto de entregador'
          })
        : null;

      const row = {
        id: randomUUID(),
        orders_count: ids.length,
        fees_cents: feesCents,
        cash_cents: cashCents,
        cash_movement_id: movementId,
        settled_by: author,
        created_at: new Date().toISOString()
      };

      await tx.courier_settlements.insertOne({ data: { ...row, store_id: storeId, courier_id: courierId } });

      for (const id of ids) {
        await tx.orders.updateOne({ data: { courier_settlement_id: row.id }, where: { id } });
      }

      return toSettlement(row);
    });
  };

  /**
   * Past settlements of the courier, newest first (the last 50).
   */
  export const list = async (db: DbClient, storeId: string, courierId: string) => {
    await findCourier(db, storeId, courierId);

    const { records } = await db.courier_settlements.findMany({
      select: {
        id: true,
        orders_count: true,
        fees_cents: true,
        cash_cents: true,
        cash_movement_id: true,
        settled_by: true,
        created_at: true
      },
      where: { store_id: storeId, courier_id: courierId }
    });

    return records
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, SETTLEMENTS_PAGE)
      .map(toSettlement);
  };
}
