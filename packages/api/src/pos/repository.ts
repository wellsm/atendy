import type { DbClient } from '../db';
import type { PosHeldSale, PosLinePatch, PosPaymentInput, PosSale, PosSalePatch } from './types';
import type { NewLine } from '../orders/repository';
import type { Discount } from '../orders/types';
import type { PaymentMethod } from '../stores/types';

import { Order } from '@ez4/database';

import { PosError, PosErrorCode } from './errors';
import { validatePayments } from './payments';
import { PosSaleList } from './types';
import { CashRepository } from '../cash/repository';
import { needsPreparation } from '../menu/preparation';
import { nextOrderCodeIn } from '../orders/code';
import { OrderRepository, prepareLine } from '../orders/repository';
import { OrderSource, OrderStatus } from '../orders/types';
import { syncOrderStock } from '../stock/order-stock';
import { findOrCreateCustomer, normalizePhone } from '../storefront/web-order';
import { StoreRepository } from '../stores/repository';

const MAX_LABEL = 40;

const MAX_NAME = 80;

const MAX_CANCEL_REASON = 200;

const PAID_STATUSES = [OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done];

/**
 * Called inside the write transaction with the sale's total discount (line + sale) and its subtotal before discounts.
 */
export type DiscountGuard = (discountCents: number, subtotalCents: number) => Promise<void>;

const guarded = async (sale: PosSale, guard: DiscountGuard | undefined) => {
  if (guard) {
    const gross = sale.items.reduce((total, item) => total + item.qty * item.unitPriceCents, 0);

    await guard(gross - sale.subtotalCents + sale.discountCents, gross);
  }

  return sale;
};

const notFound = () => new PosError(PosErrorCode.NotFound, 'Sale not found');

const cleanLabel = (label: string | null | undefined) => {
  const text = label?.trim() || null;

  if (text && text.length > MAX_LABEL) {
    throw new PosError(PosErrorCode.Label, `Label above ${MAX_LABEL} characters`);
  }

  return text;
};

/**
 * Percent: integer 1–100; value: integer cents ≥ 1. Null clears it.
 */
const checkDiscount = (discount: Discount | null | undefined) => {
  if (!discount) {
    return null;
  }

  const { kind, value } = discount;

  if (!Number.isInteger(value) || value < 1 || (kind === 'percent' && value > 100)) {
    throw new PosError(PosErrorCode.Discount, 'Invalid discount');
  }

  return { kind, value };
};

/**
 * Locks the sale row; it must be the store's POS sale.
 */
const lockSale = async (tx: DbClient, storeId: string, saleId: string) => {
  const order = await tx.orders.findOne({
    select: { store_id: true, source: true, status: true },
    where: { id: saleId },
    lock: true
  });

  if (!order || order.store_id !== storeId || order.source !== OrderSource.Pos) {
    throw notFound();
  }

  return order.status;
};

/**
 * Locks the sale row; it must be the store's POS sale and still a draft.
 */
const lockDraft = async (tx: DbClient, storeId: string, saleId: string) => {
  if ((await lockSale(tx, storeId, saleId)) !== OrderStatus.Draft) {
    throw new PosError(PosErrorCode.NotDraft, 'The sale is no longer open');
  }
};

/**
 * Locks the store row (after the order and its stock items, like `nextOrderCodeIn` and the drawer writes), so the
 * drawer cannot close between reading its open session and writing to it. Cash control off: never a session.
 */
const lockDrawer = async (tx: DbClient, storeId: string) => {
  const store = await tx.stores.findOne({ select: { payment_methods: true }, where: { id: storeId }, lock: true });
  const accepted = store?.payment_methods ?? [];

  if (!(await StoreRepository.getPosSettings(tx, storeId)).cashControl) {
    return { accepted, sessionId: null };
  }

  const session = await CashRepository.currentSession(tx, storeId);

  if (!session) {
    throw new PosError(PosErrorCode.CashClosed, 'Open the cash session first');
  }

  return { accepted, sessionId: session.id };
};

/**
 * Calendar day (YYYY-MM-DD) of an instant in the store timezone.
 */
const localDate = (timeZone: string, iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));

/**
 * Filter of a sales list; undefined when cash control is on and the drawer is closed (no session, no sales).
 */
const listWhere = async (db: DbClient, storeId: string, list: PosSaleList) => {
  const pos = { store_id: storeId, source: OrderSource.Pos };

  if (list === PosSaleList.Held) {
    return { ...pos, status: OrderStatus.Draft };
  }

  const finalized = { ...pos, status: { isIn: [...PAID_STATUSES, OrderStatus.Canceled] } };

  if (!(await StoreRepository.getPosSettings(db, storeId)).cashControl) {
    // Two days back covers today in any timezone; `listSales` keeps the store's day.
    return { ...finalized, placed_at: { gte: new Date(Date.now() - 2 * 86_400_000).toISOString() } };
  }

  const session = await CashRepository.currentSession(db, storeId);

  return session && { ...finalized, cash_session_id: session.id };
};

const findLine = async (tx: DbClient, saleId: string, itemId: string) => {
  const item = await tx.order_items.findOne({ select: { order_id: true }, where: { id: itemId } });

  if (item?.order_id !== saleId) {
    throw new PosError(PosErrorCode.NotFound, 'Line not found');
  }
};

/**
 * Counter sales (`source = pos`). Every write locks the sale row and recomputes totals through `getCart`.
 */
export namespace PosRepository {
  /**
   * Creates a held sale with the client's id; the same id again returns the existing draft.
   */
  export const createSale = async (
    db: DbClient,
    storeId: string,
    input: { id: string; label?: string | null; author: string }
  ) => {
    const now = new Date().toISOString();

    const { record } = await db.orders.upsertOne({
      select: { store_id: true, source: true, status: true },
      insert: {
        id: input.id,
        store_id: storeId,
        customer_id: null,
        conversation_id: null,
        status: OrderStatus.Draft,
        source: OrderSource.Pos,
        pos_label: cleanLabel(input.label),
        created_by: input.author,
        subtotal_cents: 0,
        fee_cents: 0,
        total_cents: 0,
        created_at: now,
        updated_at: now
      },
      update: {},
      where: { id: input.id }
    });

    if (record.store_id !== storeId || record.source !== OrderSource.Pos) {
      throw notFound();
    }

    if (record.status !== OrderStatus.Draft) {
      throw new PosError(PosErrorCode.NotDraft, 'The sale is no longer open');
    }

    return getSale(db, storeId, input.id);
  };

  export const getSale = async (db: DbClient, storeId: string, saleId: string): Promise<PosSale> => {
    const order = await db.orders.findOne({
      select: {
        store_id: true,
        source: true,
        code: true,
        pos_label: true,
        notes: true,
        customer_id: true,
        customer_name: true,
        discount: true,
        created_at: true,
        placed_at: true,
        created_by: true,
        canceled_by: true
      },
      where: { id: saleId }
    });

    if (!order || order.store_id !== storeId || order.source !== OrderSource.Pos) {
      throw notFound();
    }

    const [cart, { records: lines }, customer, { records: payments }] = await Promise.all([
      OrderRepository.getCart(db, saleId),
      db.order_items.findMany({ select: { id: true, product_id: true, discount: true }, where: { order_id: saleId } }),
      order.customer_id
        ? db.customers.findOne({ select: { name: true, phone: true }, where: { id: order.customer_id } })
        : undefined,
      db.order_payments.findMany({
        select: { id: true, method: true, amount_cents: true, received_cents: true, change_cents: true },
        where: { order_id: saleId },
        order: { created_at: Order.Asc }
      })
    ]);

    const { records: products } = lines.length
      ? await db.products.findMany({
          select: { id: true, category_id: true, needs_preparation: true },
          where: { store_id: storeId, id: { isIn: [...new Set(lines.map(({ product_id }) => product_id))] } }
        })
      : { records: [] };

    const { records: categories } = products.length
      ? await db.categories.findMany({
          select: { id: true, needs_preparation: true },
          where: { store_id: storeId, id: { isIn: [...new Set(products.map(({ category_id }) => category_id))] } }
        })
      : { records: [] };

    const lineOf = new Map(lines.map((line) => [line.id, line]));

    const preparation = lines.map(({ product_id }) => {
      const product = products.find(({ id }) => id === product_id);

      return {
        productNeeds: product?.needs_preparation ?? null,
        categoryNeeds: categories.find(({ id }) => id === product?.category_id)?.needs_preparation ?? null
      };
    });

    const name = order.customer_name ?? customer?.name ?? null;

    return {
      id: saleId,
      status: cart.status,
      code: order.code ?? null,
      label: order.pos_label ?? null,
      notes: order.notes ?? null,
      customer:
        order.customer_id || name ? { id: order.customer_id ?? null, name, phone: customer?.phone ?? null } : null,
      items: cart.items.map((item) => ({
        itemId: item.item_id,
        name: item.name,
        qty: item.qty,
        options: item.options,
        unitPriceCents: item.unit_price_cents,
        lineTotalCents: item.line_total_cents,
        notes: item.notes,
        discount: lineOf.get(item.item_id)?.discount ?? null
      })),
      discount: order.discount ?? null,
      subtotalCents: cart.subtotal_cents,
      discountCents: cart.discount_cents,
      surchargeCents: cart.surcharge_cents,
      totalCents: cart.total_cents,
      payments: payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        amountCents: payment.amount_cents,
        receivedCents: payment.received_cents ?? null,
        changeCents: payment.change_cents ?? null
      })),
      needsPreparation: needsPreparation(preparation),
      createdAt: order.created_at,
      placedAt: order.placed_at ?? null,
      createdBy: order.created_by ?? null,
      canceledBy: order.canceled_by ?? null
    };
  };

  /**
   * Held sales of the store, or the finalized ones of the open session / of today (store time); newest first.
   */
  export const listSales = async (
    db: DbClient,
    storeId: string,
    list: PosSaleList,
    timeZone: string
  ): Promise<PosHeldSale[]> => {
    const where = await listWhere(db, storeId, list);

    if (!where) {
      return [];
    }

    const { records: found } = await db.orders.findMany({
      select: {
        id: true,
        pos_label: true,
        code: true,
        status: true,
        total_cents: true,
        created_at: true,
        placed_at: true,
        canceled_at: true,
        created_by: true,
        canceled_by: true
      },
      where,
      order: list === PosSaleList.Held ? { created_at: Order.Desc } : { placed_at: Order.Desc }
    });

    const today = localDate(timeZone, new Date().toISOString());
    const sales =
      'placed_at' in where
        ? found.filter(({ placed_at }) => placed_at && localDate(timeZone, placed_at) === today)
        : found;

    const { records: lines } = sales.length
      ? await db.order_items.findMany({
          select: { order_id: true, qty: true },
          where: { order_id: { isIn: sales.map(({ id }) => id) } }
        })
      : { records: [] };

    return sales.map((sale) => ({
      id: sale.id,
      label: sale.pos_label ?? null,
      code: sale.code ?? null,
      status: sale.status,
      totalCents: sale.total_cents,
      itemsCount: lines.filter(({ order_id }) => order_id === sale.id).reduce((total, { qty }) => total + qty, 0),
      createdAt: sale.created_at,
      placedAt: sale.placed_at ?? null,
      canceledAt: sale.canceled_at ?? null,
      createdBy: sale.created_by ?? null,
      canceledBy: sale.canceled_by ?? null
    }));
  };

  export const updateSale = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    patch: PosSalePatch,
    discountGuard?: DiscountGuard
  ) => {
    const data: {
      pos_label?: string | null;
      notes?: string | null;
      discount?: Discount | null;
      surcharge_cents?: number | null;
      customer_id?: string | null;
      customer_name?: string | null;
    } = {};

    if (patch.label !== undefined) {
      data.pos_label = cleanLabel(patch.label);
    }

    if (patch.notes !== undefined) {
      data.notes = patch.notes?.trim() || null;
    }

    if (patch.discount !== undefined) {
      data.discount = checkDiscount(patch.discount);
    }

    if (patch.surchargeCents !== undefined) {
      data.surcharge_cents = patch.surchargeCents || null;
    }

    let phone: string | undefined;

    if (patch.customer !== undefined) {
      const name = patch.customer?.name?.trim() || null;
      const typed = patch.customer?.phone?.trim();

      phone = typed ? normalizePhone(typed) : undefined;

      if ((typed && !phone) || (name && name.length > MAX_NAME)) {
        throw new PosError(PosErrorCode.Customer, 'Invalid customer name or phone');
      }

      data.customer_name = name;
      data.customer_id = null;
    }

    return db.transaction(async (tx) => {
      await lockDraft(tx, storeId, saleId);

      if (phone) {
        data.customer_id = await findOrCreateCustomer(tx, storeId, phone, data.customer_name);
      }

      await tx.orders.updateOne({ data: { ...data, updated_at: new Date().toISOString() }, where: { id: saleId } });

      return guarded(await getSale(tx, storeId, saleId), discountGuard);
    });
  };

  /**
   * Adds a staff line: no store limits, sold-out items allowed (stock moves only when the sale is paid).
   */
  export const addLine = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    input: NewLine,
    discountGuard?: DiscountGuard
  ) => {
    const writeLine = await prepareLine(db, storeId, {
      ...input,
      discount: checkDiscount(input.discount),
      byStaff: true,
      skipLimits: true
    });

    return db.transaction(async (tx) => {
      await lockDraft(tx, storeId, saleId);
      await writeLine(tx, saleId);

      return guarded(await getSale(tx, storeId, saleId), discountGuard);
    });
  };

  export const updateLine = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    itemId: string,
    patch: PosLinePatch,
    discountGuard?: DiscountGuard
  ) => {
    const data: { qty?: number; notes?: string | null; discount?: Discount | null } = {};

    if (patch.qty !== undefined) {
      data.qty = patch.qty;
    }

    if (patch.notes !== undefined) {
      data.notes = patch.notes?.trim() || null;
    }

    if (patch.discount !== undefined) {
      data.discount = checkDiscount(patch.discount);
    }

    return db.transaction(async (tx) => {
      await lockDraft(tx, storeId, saleId);
      await findLine(tx, saleId, itemId);

      if (Object.keys(data).length) {
        await tx.order_items.updateOne({ data, where: { id: itemId } });
      }

      return guarded(await getSale(tx, storeId, saleId), discountGuard);
    });
  };

  export const removeLine = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    itemId: string,
    discountGuard?: DiscountGuard
  ) => {
    return db.transaction(async (tx) => {
      await lockDraft(tx, storeId, saleId);
      await findLine(tx, saleId, itemId);
      await tx.order_items.deleteMany({ where: { id: itemId } });

      return guarded(await getSale(tx, storeId, saleId), discountGuard);
    });
  };

  /**
   * Pays a held sale in one transaction: stock, code, status (`accepted` when a line needs the kitchen, else `done`),
   * the cash session and the payments. A sale that is no longer a draft is returned as it is (retries, double clicks).
   */
  export const finalize = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    input: { payments: PosPaymentInput[]; author: string }
  ) => {
    return db.transaction(async (tx) => {
      if ((await lockSale(tx, storeId, saleId)) !== OrderStatus.Draft) {
        return getSale(tx, storeId, saleId);
      }

      // Totals recomputed under the lock.
      const sale = await getSale(tx, storeId, saleId);

      if (!sale.items.length) {
        throw new PosError(PosErrorCode.NoLines, 'The sale has no items');
      }

      await syncOrderStock(tx, { storeId, orderId: saleId, enforce: false });

      const { accepted, sessionId } = await lockDrawer(tx, storeId);
      const payments = validatePayments(sale.totalCents, accepted, input.payments);
      const code = await nextOrderCodeIn(tx, storeId);
      const now = new Date().toISOString();

      await tx.orders.updateOne({
        data: {
          status: sale.needsPreparation ? OrderStatus.Accepted : OrderStatus.Done,
          code,
          placed_at: now,
          cash_session_id: sessionId,
          created_by: input.author,
          updated_at: now
        },
        where: { id: saleId }
      });

      for (const payment of payments) {
        await tx.order_payments.insertOne({
          data: {
            id: payment.id,
            store_id: storeId,
            order_id: saleId,
            method: payment.method,
            amount_cents: payment.amountCents,
            received_cents: payment.receivedCents,
            change_cents: payment.changeCents,
            created_at: now
          }
        });
      }

      return getSale(tx, storeId, saleId);
    });
  };

  /**
   * Cancels a paid sale: the stock comes back and each method's payments are refunded in the session open now
   * (none only while cash control is off). A held sale is discarded instead.
   */
  export const cancel = async (
    db: DbClient,
    storeId: string,
    saleId: string,
    input: { reason: string; author: string }
  ) => {
    const reason = input.reason.trim();

    if (!reason || reason.length > MAX_CANCEL_REASON) {
      throw new PosError(PosErrorCode.Reason, `Reason must have 1 to ${MAX_CANCEL_REASON} characters`);
    }

    return db.transaction(async (tx) => {
      if (!PAID_STATUSES.includes(await lockSale(tx, storeId, saleId))) {
        throw new PosError(PosErrorCode.NotDraft, 'Only a paid sale can be canceled');
      }

      await syncOrderStock(tx, { storeId, orderId: saleId, enforce: false, canceled: true });

      const { sessionId } = await lockDrawer(tx, storeId);
      const now = new Date().toISOString();

      await tx.orders.updateOne({
        data: {
          status: OrderStatus.Canceled,
          canceled_reason: reason,
          canceled_by: input.author,
          canceled_at: now,
          updated_at: now
        },
        where: { id: saleId }
      });

      const { records: payments } = await tx.order_payments.findMany({
        select: { method: true, amount_cents: true },
        where: { order_id: saleId }
      });

      const byMethod = new Map<PaymentMethod, number>();

      for (const { method, amount_cents } of payments) {
        byMethod.set(method, (byMethod.get(method) ?? 0) + amount_cents);
      }

      await CashRepository.recordRefunds(
        tx,
        storeId,
        sessionId,
        [...byMethod].map(([method, amountCents]) => ({ method, amountCents })),
        { orderId: saleId, reason, author: input.author }
      );

      return getSale(tx, storeId, saleId);
    });
  };

  /**
   * Deletes a held sale and its lines.
   */
  export const discard = async (db: DbClient, storeId: string, saleId: string) => {
    await db.transaction(async (tx) => {
      await lockDraft(tx, storeId, saleId);
      await tx.order_items.deleteMany({ where: { order_id: saleId } });
      await tx.orders.deleteMany({ where: { id: saleId } });
    });
  };
}
