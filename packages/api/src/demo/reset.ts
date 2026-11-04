import type { DbClient } from '../db';

import { syncOrderStock } from '../stock/order-stock';

export type DemoResetCounts = {
  conversations: number;
  orders: number;
  customers: number;
};

/**
 * Leaves a store as before its first customer: conversations, their orders (stock given back first), billing and AI
 * calls, and the customers no counter sale uses. POS, cash, settlements and settings stay (spec `demo-reset.md`).
 */
export const resetDemoStore = async (db: DbClient, storeId: string): Promise<DemoResetCounts> => {
  return db.transaction(async (tx) => {
    const { records: conversations } = await tx.conversations.findMany({
      select: { id: true },
      where: { store_id: storeId }
    });

    const conversationIds = conversations.map(({ id }) => id);

    const { records: orders } = conversationIds.length
      ? await tx.orders.findMany({
          select: { id: true },
          where: { store_id: storeId, conversation_id: { isIn: conversationIds } }
        })
      : { records: [] };

    const orderIds = orders.map(({ id }) => id);

    // Sale and return movements net zero, so dropping both leaves the balances as if the orders never happened.
    for (const orderId of orderIds) {
      await syncOrderStock(tx, { storeId, orderId, enforce: false, canceled: true });
    }

    if (orderIds.length) {
      await tx.stock_movements.deleteMany({ where: { store_id: storeId, order_id: { isIn: orderIds } } });
      await tx.order_payments.deleteMany({ where: { store_id: storeId, order_id: { isIn: orderIds } } });
      await tx.order_items.deleteMany({ where: { store_id: storeId, order_id: { isIn: orderIds } } });
      await tx.orders.deleteMany({ where: { store_id: storeId, id: { isIn: orderIds } } });
    }

    if (conversationIds.length) {
      await tx.billing_records.deleteMany({ where: { store_id: storeId, conversation_id: { isIn: conversationIds } } });
      await tx.ai_calls.deleteMany({ where: { store_id: storeId, conversation_id: { isIn: conversationIds } } });
    }

    await tx.messages.deleteMany({ where: { store_id: storeId } });
    await tx.conversations.deleteMany({ where: { store_id: storeId } });

    const [{ records: customers }, { records: kept }] = await Promise.all([
      tx.customers.findMany({ select: { id: true }, where: { store_id: storeId } }),
      tx.orders.findMany({ select: { customer_id: true }, where: { store_id: storeId, customer_id: { not: null } } })
    ]);

    const used = new Set(kept.map(({ customer_id }) => customer_id));
    const unused = customers.map(({ id }) => id).filter((id) => !used.has(id));

    if (unused.length) {
      await tx.customers.deleteMany({ where: { store_id: storeId, id: { isIn: unused } } });
    }

    return { conversations: conversationIds.length, orders: orderIds.length, customers: unused.length };
  });
};
