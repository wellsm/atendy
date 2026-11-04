import type { AsaasConfig, AsaasPayment } from './asaas-client';
import type { BillingInvoice, BillingSummary, CardHolderInput, CardInput } from './types';
import type { DbClient } from '../db';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { BillingAccounts } from './accounts';
import { AsaasClient, AsaasRequestError } from './asaas-client';
import { firstChargeDate, isPastGrace, localToday, previousCycle } from './cycle';
import { InvoiceStatus, MIN_CHARGE_CENTS } from './types';
import { notifyAdmin } from '../admin/telegram';
import { DEFAULT_ORDER_PRICE_CENTS } from '../billing/progress';

const INVOICES_PAGE_SIZE = 12;

const INVOICE_FIELDS = {
  id: true,
  store_id: true,
  period_start: true,
  period_end: true,
  orders: true,
  amount_cents: true,
  due_date: true,
  status: true,
  asaas_payment_id: true,
  invoice_url: true,
  failure_reason: true,
  paid_at: true
} as const;

type InvoiceRow = {
  id: string;
  store_id: string;
  period_start: string;
  period_end: string;
  orders: number;
  amount_cents: number;
  due_date: string;
  status: InvoiceStatus;
  asaas_payment_id?: string | null;
  invoice_url?: string | null;
  failure_reason?: string | null;
  paid_at?: string | null;
};

const toInvoice = (row: InvoiceRow, storeName: string): BillingInvoice => ({
  id: row.id,
  storeName,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  orders: row.orders,
  amountCents: row.amount_cents,
  dueDate: row.due_date,
  status: row.status,
  failureReason: row.failure_reason ?? null,
  invoiceUrl: row.invoice_url ?? null,
  paidAt: row.paid_at ?? null
});

/**
 * Asaas payment status → ours. Unknown ones keep the invoice where it is.
 */
const statusOf = (payment: AsaasPayment): InvoiceStatus | undefined => {
  switch (payment.status) {
    case 'CONFIRMED':
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return InvoiceStatus.Paid;
    case 'AWAITING_RISK_ANALYSIS':
      return InvoiceStatus.InReview;
    case 'PENDING':
      return InvoiceStatus.Pending;
    case 'OVERDUE':
      return InvoiceStatus.Overdue;
    default:
      return undefined;
  }
};

/**
 * Webhook event → invoice status and failure reason; other events are ignored.
 */
const WEBHOOK_EVENTS: Record<string, { status: InvoiceStatus; reason: string | null }> = {
  PAYMENT_CONFIRMED: { status: InvoiceStatus.Paid, reason: null },
  PAYMENT_RECEIVED: { status: InvoiceStatus.Paid, reason: null },
  PAYMENT_AWAITING_RISK_ANALYSIS: { status: InvoiceStatus.InReview, reason: null },
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: { status: InvoiceStatus.Overdue, reason: 'card_refused' },
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: { status: InvoiceStatus.Overdue, reason: 'risk_reproved' },
  PAYMENT_OVERDUE: { status: InvoiceStatus.Overdue, reason: 'overdue' }
};

const DESCRIPTION_MAX_LENGTH = 500;

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

/**
 * Asaas charge text; with more than one store, each store and its amount (the detail per store).
 */
const description = (periodStart: string, lines: { name: string; amountCents: number }[] = []) =>
  [
    `Atendy · pedidos de ${periodStart.slice(0, 7)}`,
    ...(lines.length > 1 ? lines.map(({ name, amountCents }) => `${name}: ${brl(amountCents)}`) : [])
  ]
    .join(' · ')
    .slice(0, DESCRIPTION_MAX_LENGTH);

/**
 * Records with usage not charged yet: never invoiced (including carry-over), or raised after the store's last
 * invoice. `before` limits them to a closed cycle.
 */
const uninvoiced = async (db: DbClient, storeId: string, before?: string) => {
  const {
    records: [last]
  } = await db.billing_invoices.findMany({
    select: { created_at: true },
    where: { store_id: storeId },
    order: { created_at: Order.Desc },
    take: 1
  });

  const { records } = await db.billing_records.findMany({
    select: { id: true, amount_cents: true, invoiced_cents: true },
    where: {
      store_id: storeId,
      ...(before && { created_at: { lt: before } }),
      ...(last
        ? { OR: [{ invoice_id: { isNull: true } }, { updated_at: { gte: last.created_at } }] }
        : { invoice_id: { isNull: true } })
    }
  });

  return records
    .map((record) => ({ ...record, delta: record.amount_cents - (record.invoiced_cents ?? 0) }))
    .filter(({ delta }) => delta > 0);
};

const unpaidInvoices = async (db: DbClient, storeIds: string[]) => {
  const { records } = await db.billing_invoices.findMany({
    select: INVOICE_FIELDS,
    where: { store_id: { isIn: storeIds }, status: { isIn: [InvoiceStatus.Pending, InvoiceStatus.Overdue] } },
    order: { due_date: Order.Asc }
  });

  return records;
};

/**
 * Every store paid by the same account as this one.
 */
const accountStores = async (db: DbClient, storeId: string) => {
  const account = await BillingAccounts.ensure(db, storeId);
  const { records } = await db.stores.findMany({
    select: { id: true, name: true, billing_blocked: true },
    where: { billing_account_id: account.id }
  });

  return { account, stores: records };
};

/**
 * Lifts the block of the account's stores once none of them has an overdue invoice.
 */
const unblockIfPaid = async (db: DbClient, storeIds: string[]) => {
  const overdue = await db.billing_invoices.count({
    where: { store_id: { isIn: storeIds }, status: InvoiceStatus.Overdue }
  });

  if (!overdue) {
    await db.stores.updateMany({ data: { billing_blocked: false }, where: { id: { isIn: storeIds } } });
  }
};

/**
 * Invoices of one charge: the same Asaas payment, or (no payment yet) the same cycle.
 */
const chargeGroups = (invoices: InvoiceRow[]) => {
  const groups = new Map<string, InvoiceRow[]>();

  for (const invoice of invoices) {
    const key = invoice.asaas_payment_id ?? `cycle:${invoice.period_start}`;

    groups.set(key, [...(groups.get(key) ?? []), invoice]);
  }

  return [...groups.values()];
};

const sumCents = (rows: { amount_cents: number }[]) =>
  rows.reduce((total, { amount_cents }) => total + amount_cents, 0);

const setInvoiceFromPayment = async (db: DbClient, invoiceId: string, payment: AsaasPayment) => {
  const status = statusOf(payment);
  const now = new Date().toISOString();

  await db.billing_invoices.updateOne({
    data: {
      asaas_payment_id: payment.id,
      invoice_url: payment.invoiceUrl,
      ...(status && { status }),
      ...(status === InvoiceStatus.Paid && { paid_at: now, failure_reason: null }),
      updated_at: now
    },
    where: { id: invoiceId }
  });
};

export namespace PaymentsRepository {
  export const summary = async (db: DbClient, storeId: string): Promise<BillingSummary | undefined> => {
    const store = await db.stores.findOne({
      select: { billing_blocked: true, order_price_cents: true },
      where: { id: storeId }
    });

    if (!store) {
      return undefined;
    }

    const { account, stores } = await accountStores(db, storeId);
    const ids = stores.map(({ id }) => id);
    const names = new Map(stores.map(({ id, name }) => [id, name]));

    const [open, { records: invoices }] = await Promise.all([
      Promise.all(ids.map((id) => uninvoiced(db, id))),
      db.billing_invoices.findMany({
        select: INVOICE_FIELDS,
        where: { store_id: { isIn: ids } },
        order: { period_start: Order.Desc },
        take: INVOICES_PAGE_SIZE * ids.length
      })
    ]);

    const openRecords = open.flat();

    return {
      card: account.card_brand && account.card_last4 ? { brand: account.card_brand, last4: account.card_last4 } : null,
      blocked: !!store.billing_blocked,
      priceCents: store.order_price_cents ?? DEFAULT_ORDER_PRICE_CENTS,
      open: { orders: openRecords.length, amountCents: openRecords.reduce((total, { delta }) => total + delta, 0) },
      invoices: invoices.map((invoice) => toInvoice(invoice, names.get(invoice.store_id) ?? ''))
    };
  };

  /**
   * Saves (or swaps) the account's card through its Asaas subscription, then charges what is already due for any of
   * its stores: invoices closed without a card, or refused ones (one charge per payment or cycle). Asaas refusing the
   * card throws `AsaasRequestError` (`refused`).
   */
  export const registerCard = async (
    db: DbClient,
    config: AsaasConfig,
    input: { storeId: string; holder: CardHolderInput; card: CardInput; remoteIp: string; now: Date }
  ) => {
    const { storeId, holder, card, remoteIp, now } = input;
    const { account, stores } = await accountStores(db, storeId);
    const ids = stores.map(({ id }) => id);
    const names = new Map(stores.map(({ id, name }) => [id, name]));
    const at = now.toISOString();

    let customerId = account.asaas_customer_id;

    if (!customerId) {
      ({ id: customerId } = await AsaasClient.createCustomer(config, { holder, externalReference: account.id }));

      await db.billing_accounts.updateOne({
        data: { asaas_customer_id: customerId, updated_at: at },
        where: { id: account.id }
      });
    }

    if (account.asaas_subscription_id) {
      const summary = await AsaasClient.updateSubscriptionCard(config, {
        subscriptionId: account.asaas_subscription_id,
        holder,
        card,
        remoteIp
      });

      await db.billing_accounts.updateOne({
        data: { card_brand: summary.brand, card_last4: summary.last4, updated_at: at },
        where: { id: account.id }
      });
    } else {
      const subscription = await AsaasClient.createSubscription(config, {
        customerId,
        valueCents: MIN_CHARGE_CENTS,
        nextDueDate: firstChargeDate(now),
        description: `Atendy · ${stores.map(({ name }) => name).join(', ')}`.slice(0, DESCRIPTION_MAX_LENGTH),
        externalReference: account.id,
        holder,
        card,
        remoteIp
      });

      await db.billing_accounts.updateOne({
        data: {
          asaas_subscription_id: subscription.id,
          card_brand: subscription.brand,
          card_last4: subscription.last4,
          updated_at: at
        },
        where: { id: account.id }
      });
    }

    for (const group of chargeGroups(await unpaidInvoices(db, ids))) {
      const [first] = group;
      const paymentId = first?.asaas_payment_id;

      // A pending payment is charged on its due date with the new card.
      if (!first || (paymentId && group.every(({ status }) => status === InvoiceStatus.Pending))) {
        continue;
      }

      try {
        const payment = paymentId
          ? await AsaasClient.payWithCard(config, { paymentId, holder, card, remoteIp })
          : await AsaasClient.chargeCard(config, {
              customerId,
              valueCents: sumCents(group),
              dueDate: localToday(now),
              description: description(
                first.period_start,
                group.map((invoice) => ({ name: names.get(invoice.store_id) ?? '', amountCents: invoice.amount_cents }))
              ),
              externalReference: first.id,
              holder,
              card,
              remoteIp
            });

        for (const invoice of group) {
          await setInvoiceFromPayment(db, invoice.id, payment);
        }
      } catch (error) {
        if (!(error instanceof AsaasRequestError && error.refused)) {
          throw error;
        }

        await db.billing_invoices.updateMany({
          data: { status: InvoiceStatus.Overdue, failure_reason: 'card_refused', updated_at: at },
          where: { id: { isIn: group.map(({ id }) => id) } }
        });
      }
    }

    await unblockIfPaid(db, ids);
  };

  /**
   * Daily job (idempotent): closes the previous calendar month per billing account (one invoice per store with usage,
   * the minimum charge on the account total), sets the account subscription's payment of this cycle to their sum (or
   * deletes it when nothing is due), marks due invoices without a card as overdue and blocks every store of an account
   * past the grace days. `only` limits it to the accounts of some stores (tests).
   */
  export const runDaily = async (db: DbClient, config: AsaasConfig, now: Date, only?: string[]) => {
    const cycle = previousCycle(now);
    const today = localToday(now);

    const { records: listed } = await db.stores.findMany({
      select: { id: true, billing_account_id: true },
      ...(only && { where: { id: { isIn: only } } })
    });

    const accountIds = new Set<string>();

    for (const store of listed) {
      accountIds.add(store.billing_account_id ?? (await BillingAccounts.ensure(db, store.id)).id);
    }

    const scopeIds: string[] = [];
    const blockable: { accountId: string; stores: { id: string; name: string; billing_blocked?: boolean | null }[] }[] =
      [];

    for (const accountId of accountIds) {
      const [account, { records: stores }] = await Promise.all([
        db.billing_accounts.findOne({ select: { asaas_subscription_id: true }, where: { id: accountId } }),
        db.stores.findMany({
          select: { id: true, name: true, billing_blocked: true },
          where: { billing_account_id: accountId }
        })
      ]);

      const ids = stores.map(({ id }) => id);

      scopeIds.push(...ids);
      blockable.push({ accountId, stores });

      const { records: existing } = await db.billing_invoices.findMany({
        select: { id: true, store_id: true, amount_cents: true, asaas_payment_id: true, status: true },
        where: { store_id: { isIn: ids }, period_start: cycle.periodStart }
      });

      const invoices = existing.length ? existing : await closeCycle(db, stores, cycle, now);

      // Before the charge date, the subscription's payment of this cycle must carry the real amount (or not exist). An
      // invoice still without a payment (a store that joined after the close) re-syncs the sum, unless one is paid.
      const unsynced = !invoices.length || invoices.some((row) => !row.asaas_payment_id);
      const paid = invoices.some((row) => row.status === InvoiceStatus.Paid);

      if (account?.asaas_subscription_id && today < cycle.dueDate && unsynced && !paid) {
        const names = new Map(stores.map(({ id, name }) => [id, name]));

        await syncSubscription(db, config, {
          subscriptionId: account.asaas_subscription_id,
          cycle,
          invoices: invoices.map((invoice) => ({ ...invoice, name: names.get(invoice.store_id) ?? '' }))
        });
      }
    }

    await db.billing_invoices.updateMany({
      data: { status: InvoiceStatus.Overdue, failure_reason: 'no_card', updated_at: now.toISOString() },
      where: {
        store_id: { isIn: scopeIds },
        status: InvoiceStatus.Pending,
        asaas_payment_id: { isNull: true },
        due_date: { lte: today }
      }
    });

    const { records: overdue } = await db.billing_invoices.findMany({
      select: { store_id: true, due_date: true },
      where: { store_id: { isIn: scopeIds }, status: InvoiceStatus.Overdue }
    });

    const late = new Set(overdue.filter(({ due_date }) => isPastGrace(due_date, now)).map((row) => row.store_id));

    for (const { stores } of blockable) {
      const open = stores.filter(({ billing_blocked }) => !billing_blocked);

      if (!stores.some(({ id }) => late.has(id)) || !open.length) {
        continue;
      }

      await db.stores.updateMany({
        data: { billing_blocked: true },
        where: { id: { isIn: open.map(({ id }) => id) } }
      });
      await notifyAdmin(
        `Loja bloqueada por fatura em aberto: ${open.map(({ name, id }) => `${name} ${id}`).join(', ')}`
      );
    }
  };

  /**
   * One invoice per store with usage in a closed cycle, or none when the account total stays below the minimum (it
   * carries over).
   */
  const closeCycle = async (
    db: DbClient,
    stores: { id: string }[],
    cycle: ReturnType<typeof previousCycle>,
    now: Date
  ) => {
    const usage = await Promise.all(
      stores.map(async ({ id }) => ({ storeId: id, records: await uninvoiced(db, id, cycle.periodEnd) }))
    );

    const lines = usage
      .map(({ storeId, records }) => ({
        storeId,
        records,
        amountCents: records.reduce((total, { delta }) => total + delta, 0)
      }))
      .filter(({ amountCents }) => amountCents > 0);

    if (lines.reduce((total, { amountCents }) => total + amountCents, 0) < MIN_CHARGE_CENTS) {
      return [];
    }

    const at = now.toISOString();
    const invoices = lines.map((line) => ({
      id: randomUUID(),
      store_id: line.storeId,
      amount_cents: line.amountCents,
      asaas_payment_id: null,
      status: InvoiceStatus.Pending
    }));

    await db.transaction(async (tx) => {
      for (const [index, line] of lines.entries()) {
        const invoice = invoices[index]!;

        await tx.billing_invoices.insertOne({
          data: {
            id: invoice.id,
            store_id: line.storeId,
            period_start: cycle.periodStart,
            period_end: cycle.periodEnd,
            orders: line.records.length,
            amount_cents: line.amountCents,
            due_date: cycle.dueDate,
            status: InvoiceStatus.Pending,
            created_at: at,
            updated_at: at
          }
        });

        for (const record of line.records) {
          await tx.billing_records.updateOne({
            data: { invoiced_cents: record.amount_cents, invoice_id: invoice.id },
            where: { id: record.id }
          });
        }
      }
    });

    return invoices;
  };

  const syncSubscription = async (
    db: DbClient,
    config: AsaasConfig,
    input: {
      subscriptionId: string;
      cycle: ReturnType<typeof previousCycle>;
      invoices: { id: string; amount_cents: number; name: string }[];
    }
  ) => {
    const { cycle, invoices } = input;
    const payments = await AsaasClient.listSubscriptionPayments(config, input.subscriptionId);
    const payment = payments.find(({ dueDate }) => dueDate === cycle.dueDate);

    if (!payment) {
      return;
    }

    if (!invoices.length) {
      await AsaasClient.deletePayment(config, payment.id);

      return;
    }

    const updated = await AsaasClient.updatePayment(config, {
      paymentId: payment.id,
      valueCents: sumCents(invoices),
      dueDate: cycle.dueDate,
      description: description(
        cycle.periodStart,
        invoices.map(({ name, amount_cents }) => ({ name, amountCents: amount_cents }))
      )
    });

    for (const invoice of invoices) {
      await setInvoiceFromPayment(db, invoice.id, updated);
    }
  };

  /**
   * Admin test: moves the account's pending payment (set at close) to today, so Asaas charges the card now instead of
   * on the charge day. Returns false when no invoice has a pending payment.
   */
  export const chargeNow = async (db: DbClient, config: AsaasConfig, storeId: string, now: Date) => {
    const { stores } = await accountStores(db, storeId);

    const {
      records: [latest]
    } = await db.billing_invoices.findMany({
      select: { asaas_payment_id: true },
      where: {
        store_id: { isIn: stores.map(({ id }) => id) },
        status: InvoiceStatus.Pending,
        asaas_payment_id: { isNull: false }
      },
      order: { period_start: Order.Desc },
      take: 1
    });

    if (!latest?.asaas_payment_id) {
      return false;
    }

    const { records: invoices } = await db.billing_invoices.findMany({
      select: { id: true, store_id: true, period_start: true, amount_cents: true },
      where: { asaas_payment_id: latest.asaas_payment_id }
    });

    const names = new Map(stores.map(({ id, name }) => [id, name]));
    const today = localToday(now);

    const payment = await AsaasClient.updatePayment(config, {
      paymentId: latest.asaas_payment_id,
      valueCents: sumCents(invoices),
      dueDate: today,
      description: description(
        invoices[0]?.period_start ?? today,
        invoices.map((invoice) => ({ name: names.get(invoice.store_id) ?? '', amountCents: invoice.amount_cents }))
      )
    });

    for (const invoice of invoices) {
      await db.billing_invoices.updateOne({ data: { due_date: today }, where: { id: invoice.id } });
      await setInvoiceFromPayment(db, invoice.id, payment);
    }

    return true;
  };

  /**
   * Asaas payment event, for every invoice the payment charges. Idempotent; a paid invoice never goes back; unknown
   * payments are ignored.
   */
  export const applyWebhook = async (
    db: DbClient,
    input: { event: string; paymentId: string; invoiceUrl: string | null; now: Date }
  ) => {
    const change = WEBHOOK_EVENTS[input.event];

    if (!change) {
      return;
    }

    const { records } = await db.billing_invoices.findMany({
      select: { id: true, store_id: true, status: true },
      where: { asaas_payment_id: input.paymentId }
    });

    const open = records.filter(({ status }) => status !== InvoiceStatus.Paid);
    const [first] = open;

    if (!first) {
      return;
    }

    const at = input.now.toISOString();

    await db.billing_invoices.updateMany({
      data: {
        status: change.status,
        failure_reason: change.reason,
        ...(input.invoiceUrl && { invoice_url: input.invoiceUrl }),
        ...(change.status === InvoiceStatus.Paid && { paid_at: at }),
        updated_at: at
      },
      where: { id: { isIn: open.map(({ id }) => id) } }
    });

    const { stores } = await accountStores(db, first.store_id);

    if (change.status === InvoiceStatus.Paid) {
      await unblockIfPaid(
        db,
        stores.map(({ id }) => id)
      );
    }

    if (change.status === InvoiceStatus.Overdue) {
      await notifyAdmin(
        `Cobrança recusada (${change.reason}): ${stores.map(({ name, id }) => `${name} ${id}`).join(', ')}`
      );
    }
  };
}
