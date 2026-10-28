import type { DbClient } from '../db';
import type { CashReport, CashSummaryInput } from './summary';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { CashError, CashErrorCode } from './errors';
import { cashSummary } from './summary';
import { CashMovementKind } from './types';
import { PaymentMethod } from '../stores/types';

export type CashSession = {
  id: string;
  openedBy: string;
  openedAt: string;
  floatCents: number;
  closedBy: string | null;
  closedAt: string | null;
  countedCents: number | null;
  expectedCents: number | null;
};

export type CashMovementView = {
  id: string;
  kind: CashMovementKind;
  method: PaymentMethod;
  amountCents: number;
  reason: string | null;
  author: string;
  orderId: string | null;
  createdAt: string;
};

type SessionRow = {
  id: string;
  store_id: string;
  opened_by: string;
  opened_at: string;
  float_cents: number;
  closed_by?: string | null;
  closed_at?: string | null;
  counted_cents?: number | null;
  expected_cents?: number | null;
};

type MovementRow = {
  id: string;
  kind: CashMovementKind;
  method: PaymentMethod;
  amount_cents: number;
  reason?: string | null;
  author: string;
  order_id?: string | null;
  created_at: string;
};

const SESSION_SELECT = {
  id: true,
  store_id: true,
  opened_by: true,
  opened_at: true,
  float_cents: true,
  closed_by: true,
  closed_at: true,
  counted_cents: true,
  expected_cents: true
} as const;

const MAX_REASON_LENGTH = 120;

const SESSIONS_PAGE = 30;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toSession = (row: SessionRow): CashSession => ({
  id: row.id,
  openedBy: row.opened_by,
  openedAt: row.opened_at,
  floatCents: row.float_cents,
  closedBy: row.closed_by ?? null,
  closedAt: row.closed_at ?? null,
  countedCents: row.counted_cents ?? null,
  expectedCents: row.expected_cents ?? null
});

const toMovement = (row: MovementRow): CashMovementView => ({
  id: row.id,
  kind: row.kind,
  method: row.method,
  amountCents: row.amount_cents,
  reason: row.reason ?? null,
  author: row.author,
  orderId: row.order_id ?? null,
  createdAt: row.created_at
});

const validateAmount = (value: number, min: number) => {
  if (!Number.isInteger(value) || value < min) {
    throw new CashError(CashErrorCode.Amount, `Amount must be whole cents, at least ${min}.`);
  }
};

const parseCursor = (value: string) => {
  const [closedAt, id, ...rest] = value.split('_');

  if (!closedAt || !id || rest.length || Number.isNaN(Date.parse(closedAt)) || !UUID_PATTERN.test(id)) {
    throw new CashError(CashErrorCode.Before, 'Invalid cursor.');
  }

  return { closedAt, id };
};

/**
 * Every drawer write locks the store row first, so opening, moving, receiving order cash and closing never interleave
 * (one open session; nothing lands in a session after its close). Callers that hold an order lock take it before this.
 */
const lockStore = async (tx: DbClient, storeId: string) => {
  await tx.stores.findOne({ select: { id: true }, where: { id: storeId }, lock: true });
};

const findOpen = async (db: DbClient, storeId: string) => {
  const { records } = await db.cash_sessions.findMany({
    select: SESSION_SELECT,
    where: { store_id: storeId, closed_at: null },
    take: 1
  });

  return records[0];
};

const usedDrawer = async (db: DbClient, storeId: string) => {
  const { records } = await db.cash_sessions.findMany({ select: { id: true }, where: { store_id: storeId }, take: 1 });

  return records.length > 0;
};

const findSession = async (db: DbClient, storeId: string, sessionId: string) => {
  const session = await db.cash_sessions.findOne({ select: SESSION_SELECT, where: { id: sessionId } });

  if (!session || session.store_id !== storeId) {
    throw new CashError(CashErrorCode.NotFound, 'Cash session not found.');
  }

  return session;
};

type SessionSales = Pick<
  CashSummaryInput,
  'payments' | 'salesCount' | 'canceledCount' | 'discountsCents' | 'surchargesCents'
>;

/**
 * The session's POS sales (`orders.cash_session_id`) and their payments. A sale counts as canceled only when the POS
 * canceled it (`canceled_at`) while the session was open, so a closed report never changes: a later cancel shows only
 * as refunds in the session open then. Discounts and surcharges count the sales that were not canceled; discounts
 * are the lines' gross minus what the sale charged.
 */
const readSales = async (db: DbClient, storeId: string, session: SessionRow): Promise<SessionSales> => {
  const { records: orders } = await db.orders.findMany({
    select: { id: true, canceled_at: true, fee_cents: true, surcharge_cents: true, total_cents: true },
    where: { store_id: storeId, cash_session_id: session.id }
  });

  if (!orders.length) {
    return { payments: [], salesCount: 0, canceledCount: 0, discountsCents: 0, surchargesCents: 0 };
  }

  const orderIds = orders.map(({ id }) => id);

  const [{ records: payments }, { records: items }] = await Promise.all([
    db.order_payments.findMany({
      select: { order_id: true, method: true, amount_cents: true },
      where: { store_id: storeId, order_id: { isIn: orderIds } }
    }),
    db.order_items.findMany({
      select: { order_id: true, qty: true, unit_price_cents: true },
      where: { order_id: { isIn: orderIds } }
    })
  ]);

  const closedAt = session.closed_at ? Date.parse(session.closed_at) : Infinity;

  const canceled = new Set(
    orders.filter(({ canceled_at }) => canceled_at && Date.parse(canceled_at) <= closedAt).map(({ id }) => id)
  );
  const sales = orders.filter(({ id }) => !canceled.has(id));

  const grossCents = items
    .filter(({ order_id }) => !canceled.has(order_id))
    .reduce((total, { qty, unit_price_cents }) => total + qty * unit_price_cents, 0);

  const surchargesCents = sales.reduce((total, { surcharge_cents }) => total + (surcharge_cents ?? 0), 0);
  const chargedCents = sales.reduce((total, { fee_cents, total_cents }) => total + total_cents - fee_cents, 0);

  return {
    payments: payments.map((row) => ({
      method: row.method,
      amountCents: row.amount_cents,
      canceled: canceled.has(row.order_id)
    })),
    salesCount: sales.length,
    canceledCount: canceled.size,
    discountsCents: grossCents + surchargesCents - chargedCents,
    surchargesCents
  };
};

const buildReport = async (db: DbClient, storeId: string, session: SessionRow): Promise<CashReport> => {
  const { records: movements } = await db.cash_movements.findMany({
    select: { kind: true, method: true, amount_cents: true },
    where: { store_id: storeId, session_id: session.id }
  });

  const sales = await readSales(db, storeId, session);

  return cashSummary({
    ...sales,
    floatCents: session.float_cents,
    movements: movements.map((row) => ({ kind: row.kind, method: row.method, amountCents: row.amount_cents })),
    countedCents: session.counted_cents ?? null
  });
};

export namespace CashRepository {
  export const currentSession = async (db: DbClient, storeId: string) => {
    const session = await findOpen(db, storeId);

    return session && toSession(session);
  };

  export const getSession = async (db: DbClient, storeId: string, sessionId: string) => {
    return toSession(await findSession(db, storeId, sessionId));
  };

  /**
   * Opens the store's session and claims the order cash received while the drawer was closed.
   */
  export const open = async (db: DbClient, storeId: string, input: { floatCents: number; author: string }) => {
    validateAmount(input.floatCents, 0);

    return db.transaction(async (tx) => {
      await lockStore(tx, storeId);

      if (await findOpen(tx, storeId)) {
        throw new CashError(CashErrorCode.SessionOpen, 'A cash session is already open.');
      }

      const now = new Date().toISOString();

      const row: SessionRow = {
        id: randomUUID(),
        store_id: storeId,
        opened_by: input.author,
        opened_at: now,
        float_cents: input.floatCents
      };

      await tx.cash_sessions.insertOne({ data: { ...row, created_at: now } });

      await tx.cash_movements.updateMany({
        data: { session_id: row.id },
        where: { store_id: storeId, session_id: null, kind: CashMovementKind.OrderCash }
      });

      return toSession(row);
    });
  };

  /**
   * Sangria (cash out) or suprimento (cash in) in the open session.
   */
  export const move = async (
    db: DbClient,
    storeId: string,
    input: {
      kind: CashMovementKind.Sangria | CashMovementKind.Suprimento;
      amountCents: number;
      reason: string;
      author: string;
    }
  ) => {
    validateAmount(input.amountCents, 1);

    const reason = input.reason.trim();

    if (!reason || reason.length > MAX_REASON_LENGTH) {
      throw new CashError(CashErrorCode.Reason, `Reason must have 1 to ${MAX_REASON_LENGTH} characters.`);
    }

    return db.transaction(async (tx) => {
      await lockStore(tx, storeId);

      const session = await findOpen(tx, storeId);

      if (!session) {
        throw new CashError(CashErrorCode.NoSession, 'Open the cash session first.');
      }

      const row: MovementRow = {
        id: randomUUID(),
        kind: input.kind,
        method: PaymentMethod.Cash,
        amount_cents: input.amountCents,
        reason,
        author: input.author,
        created_at: new Date().toISOString()
      };

      await tx.cash_movements.insertOne({ data: { ...row, store_id: storeId, session_id: session.id } });

      return toMovement(row);
    });
  };

  /**
   * Cash of a WhatsApp/web order that reached `done`. `tx` must be a transaction; with no open session the receipt
   * waits (`session_id` null) for the next `open`, unless the store never opened one (then nothing is recorded).
   */
  export const recordOrderCash = async (
    tx: DbClient,
    storeId: string,
    input: { orderId: string; amountCents: number; author: string }
  ) => {
    if (input.amountCents < 1) {
      return;
    }

    await lockStore(tx, storeId);

    const session = await findOpen(tx, storeId);

    // A store that never opened the drawer does not pile up receipts for its first session to claim.
    if (!session && !(await usedDrawer(tx, storeId))) {
      return;
    }

    await tx.cash_movements.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        session_id: session?.id ?? null,
        kind: CashMovementKind.OrderCash,
        method: PaymentMethod.Cash,
        amount_cents: input.amountCents,
        author: input.author,
        order_id: input.orderId,
        created_at: new Date().toISOString()
      }
    });
  };

  /**
   * Refunds of a canceled sale, one row per method, in the session open at cancel time (`null`: cash control off).
   * `tx` must be a transaction; a closed or another store's session throws `no_session`.
   */
  export const recordRefunds = async (
    tx: DbClient,
    storeId: string,
    sessionId: string | null,
    refunds: { method: PaymentMethod; amountCents: number }[],
    input: { orderId: string; reason: string; author: string }
  ) => {
    await lockStore(tx, storeId);

    if (sessionId !== null && (await findOpen(tx, storeId))?.id !== sessionId) {
      throw new CashError(CashErrorCode.NoSession, 'Refunds go into the open cash session.');
    }

    const now = new Date().toISOString();

    for (const refund of refunds.filter(({ amountCents }) => amountCents > 0)) {
      await tx.cash_movements.insertOne({
        data: {
          id: randomUUID(),
          store_id: storeId,
          session_id: sessionId,
          kind: CashMovementKind.Refund,
          method: refund.method,
          amount_cents: refund.amountCents,
          reason: input.reason,
          author: input.author,
          order_id: input.orderId,
          created_at: now
        }
      });
    }
  };

  /**
   * Closes the session with the counted cash and keeps the expected amount it had then. A closed session never changes.
   */
  export const close = async (
    db: DbClient,
    storeId: string,
    sessionId: string,
    input: { countedCents: number; author: string }
  ) => {
    validateAmount(input.countedCents, 0);

    return db.transaction(async (tx) => {
      await lockStore(tx, storeId);

      const session = await findSession(tx, storeId, sessionId);

      if (session.closed_at) {
        throw new CashError(CashErrorCode.AlreadyClosed, 'This cash session is already closed.');
      }

      const report = await buildReport(tx, storeId, { ...session, counted_cents: input.countedCents });

      await tx.cash_sessions.updateOne({
        data: {
          closed_by: input.author,
          closed_at: new Date().toISOString(),
          counted_cents: input.countedCents,
          expected_cents: report.expectedCashCents
        },
        where: { id: sessionId }
      });

      return report;
    });
  };

  export const report = async (db: DbClient, storeId: string, sessionId: string) => {
    return buildReport(db, storeId, await findSession(db, storeId, sessionId));
  };

  /**
   * Closed sessions, newest close first (`closed_at`, then `id`). `next` is the cursor of the following page
   * (`before`), null on the last one.
   */
  export const listSessions = async (db: DbClient, storeId: string, page: { before?: string }) => {
    const cursor = page.before === undefined ? undefined : parseCursor(page.before);

    const { records: found } = await db.cash_sessions.findMany({
      select: SESSION_SELECT,
      where: {
        store_id: storeId,
        closed_at: { isNull: false },
        ...(cursor && {
          OR: [{ closed_at: { lt: cursor.closedAt } }, { closed_at: cursor.closedAt, id: { lt: cursor.id } }]
        })
      },
      order: { closed_at: Order.Desc, id: Order.Desc },
      take: SESSIONS_PAGE + 1
    });

    const records = found.slice(0, SESSIONS_PAGE);
    const last = records[records.length - 1];

    return {
      sessions: records.map(toSession),
      next: found.length > SESSIONS_PAGE && last ? `${last.closed_at}_${last.id}` : null
    };
  };
}
