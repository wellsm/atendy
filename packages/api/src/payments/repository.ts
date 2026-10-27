import type { AsaasConfig, AsaasPayment } from './asaas-client';
import type { BillingInvoice, BillingSummary, CardHolderInput, CardInput } from './types';
import type { DbClient } from '../db';

import { randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

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

const toInvoice = (row: InvoiceRow): BillingInvoice => ({
  id: row.id,
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

const description = (periodStart: string) => `Atendy · pedidos de ${periodStart.slice(0, 7)}`;

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

const unpaidInvoices = async (db: DbClient, storeId: string) => {
  const { records } = await db.billing_invoices.findMany({
    select: INVOICE_FIELDS,
    where: { store_id: storeId, status: { isIn: [InvoiceStatus.Pending, InvoiceStatus.Overdue] } },
    order: { due_date: Order.Asc }
  });

  return records;
};

/**
 * Lifts the block once nothing is overdue.
 */
const unblockIfPaid = async (db: DbClient, storeId: string) => {
  const overdue = await db.billing_invoices.count({ where: { store_id: storeId, status: InvoiceStatus.Overdue } });

  if (!overdue) {
    await db.stores.updateOne({ data: { billing_blocked: false }, where: { id: storeId } });
  }
};

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
      select: { card_brand: true, card_last4: true, billing_blocked: true, order_price_cents: true },
      where: { id: storeId }
    });

    if (!store) {
      return undefined;
    }

    const [open, { records: invoices }] = await Promise.all([
      uninvoiced(db, storeId),
      db.billing_invoices.findMany({
        select: INVOICE_FIELDS,
        where: { store_id: storeId },
        order: { period_start: Order.Desc },
        take: INVOICES_PAGE_SIZE
      })
    ]);

    return {
      card: store.card_brand && store.card_last4 ? { brand: store.card_brand, last4: store.card_last4 } : null,
      blocked: !!store.billing_blocked,
      priceCents: store.order_price_cents ?? DEFAULT_ORDER_PRICE_CENTS,
      open: { orders: open.length, amountCents: open.reduce((total, { delta }) => total + delta, 0) },
      invoices: invoices.map(toInvoice)
    };
  };

  /**
   * Saves (or swaps) the store's card through its Asaas subscription, then charges what is already due: invoices
   * closed without a card, or refused ones. Asaas refusing the card throws `AsaasRequestError` (`refused`).
   */
  export const registerCard = async (
    db: DbClient,
    config: AsaasConfig,
    input: { storeId: string; holder: CardHolderInput; card: CardInput; remoteIp: string; now: Date }
  ) => {
    const { storeId, holder, card, remoteIp, now } = input;

    const store = await db.stores.findOne({
      select: { name: true, asaas_customer_id: true, asaas_subscription_id: true },
      where: { id: storeId }
    });

    if (!store) {
      throw new Error('Store not found');
    }

    let customerId = store.asaas_customer_id;

    if (!customerId) {
      ({ id: customerId } = await AsaasClient.createCustomer(config, { holder, externalReference: storeId }));

      await db.stores.updateOne({ data: { asaas_customer_id: customerId }, where: { id: storeId } });
    }

    if (store.asaas_subscription_id) {
      const summary = await AsaasClient.updateSubscriptionCard(config, {
        subscriptionId: store.asaas_subscription_id,
        holder,
        card,
        remoteIp
      });

      await db.stores.updateOne({
        data: { card_brand: summary.brand, card_last4: summary.last4 },
        where: { id: storeId }
      });
    } else {
      const subscription = await AsaasClient.createSubscription(config, {
        customerId,
        valueCents: MIN_CHARGE_CENTS,
        nextDueDate: firstChargeDate(now),
        description: `Atendy · ${store.name}`,
        externalReference: storeId,
        holder,
        card,
        remoteIp
      });

      await db.stores.updateOne({
        data: {
          asaas_subscription_id: subscription.id,
          card_brand: subscription.brand,
          card_last4: subscription.last4
        },
        where: { id: storeId }
      });
    }

    for (const invoice of await unpaidInvoices(db, storeId)) {
      // A pending invoice with its payment set is charged on its due date with the new card.
      if (invoice.status === InvoiceStatus.Pending && invoice.asaas_payment_id) {
        continue;
      }

      try {
        const payment = invoice.asaas_payment_id
          ? await AsaasClient.payWithCard(config, { paymentId: invoice.asaas_payment_id, holder, card, remoteIp })
          : await AsaasClient.chargeCard(config, {
              customerId,
              valueCents: invoice.amount_cents,
              dueDate: localToday(now),
              description: description(invoice.period_start),
              externalReference: invoice.id,
              holder,
              card,
              remoteIp
            });

        await setInvoiceFromPayment(db, invoice.id, payment);
      } catch (error) {
        if (!(error instanceof AsaasRequestError && error.refused)) {
          throw error;
        }

        await db.billing_invoices.updateOne({
          data: { status: InvoiceStatus.Overdue, failure_reason: 'card_refused', updated_at: now.toISOString() },
          where: { id: invoice.id }
        });
      }
    }

    await unblockIfPaid(db, storeId);
  };

  /**
   * Daily job (idempotent): closes the previous calendar month per store, sets each card subscription's payment of
   * this cycle to the invoice amount (or deletes it when nothing is due), marks due invoices without a card as
   * overdue and blocks stores past the grace days. `only` limits it to some stores (tests).
   */
  export const runDaily = async (db: DbClient, config: AsaasConfig, now: Date, only?: string[]) => {
    const cycle = previousCycle(now);
    const today = localToday(now);
    const scope = only ? { store_id: { isIn: only } } : {};

    const { records: stores } = await db.stores.findMany({
      select: { id: true, name: true, asaas_subscription_id: true, billing_blocked: true },
      ...(only && { where: { id: { isIn: only } } })
    });

    for (const store of stores) {
      const {
        records: [existing]
      } = await db.billing_invoices.findMany({
        select: { id: true, amount_cents: true, asaas_payment_id: true },
        where: { store_id: store.id, period_start: cycle.periodStart },
        take: 1
      });

      const invoice = existing ?? (await closeCycle(db, store.id, cycle, now));

      // Before the charge date, the subscription's payment of this cycle must carry the real amount (or not exist).
      if (store.asaas_subscription_id && today < cycle.dueDate && !invoice?.asaas_payment_id) {
        await syncSubscription(db, config, {
          subscriptionId: store.asaas_subscription_id,
          cycle,
          invoice: invoice ?? null
        });
      }
    }

    await db.billing_invoices.updateMany({
      data: { status: InvoiceStatus.Overdue, failure_reason: 'no_card', updated_at: now.toISOString() },
      where: { ...scope, status: InvoiceStatus.Pending, asaas_payment_id: { isNull: true }, due_date: { lte: today } }
    });

    const { records: overdue } = await db.billing_invoices.findMany({
      select: { store_id: true, due_date: true },
      where: { ...scope, status: InvoiceStatus.Overdue }
    });

    for (const storeId of new Set(
      overdue.filter(({ due_date }) => isPastGrace(due_date, now)).map((row) => row.store_id)
    )) {
      const store = stores.find(({ id }) => id === storeId);

      if (!store || store.billing_blocked) {
        continue;
      }

      await db.stores.updateOne({ data: { billing_blocked: true }, where: { id: storeId } });
      await notifyAdmin(`Loja bloqueada por fatura em aberto: ${store.name} ${store.id}`);
    }
  };

  /**
   * Invoice of a closed cycle, or undefined when it stays below the minimum (it carries over).
   */
  const closeCycle = async (db: DbClient, storeId: string, cycle: ReturnType<typeof previousCycle>, now: Date) => {
    const records = await uninvoiced(db, storeId, cycle.periodEnd);
    const amountCents = records.reduce((total, { delta }) => total + delta, 0);

    if (amountCents < MIN_CHARGE_CENTS) {
      return undefined;
    }

    const id = randomUUID();
    const at = now.toISOString();

    await db.transaction(async (tx) => {
      await tx.billing_invoices.insertOne({
        data: {
          id,
          store_id: storeId,
          period_start: cycle.periodStart,
          period_end: cycle.periodEnd,
          orders: records.length,
          amount_cents: amountCents,
          due_date: cycle.dueDate,
          status: InvoiceStatus.Pending,
          created_at: at,
          updated_at: at
        }
      });

      for (const record of records) {
        await tx.billing_records.updateOne({
          data: { invoiced_cents: record.amount_cents, invoice_id: id },
          where: { id: record.id }
        });
      }
    });

    return { id, amount_cents: amountCents, asaas_payment_id: null };
  };

  const syncSubscription = async (
    db: DbClient,
    config: AsaasConfig,
    input: {
      subscriptionId: string;
      cycle: ReturnType<typeof previousCycle>;
      invoice: { id: string; amount_cents: number } | null;
    }
  ) => {
    const { cycle, invoice } = input;
    const payments = await AsaasClient.listSubscriptionPayments(config, input.subscriptionId);
    const payment = payments.find(({ dueDate }) => dueDate === cycle.dueDate);

    if (!payment) {
      return;
    }

    if (!invoice) {
      await AsaasClient.deletePayment(config, payment.id);

      return;
    }

    const updated = await AsaasClient.updatePayment(config, {
      paymentId: payment.id,
      valueCents: invoice.amount_cents,
      dueDate: cycle.dueDate,
      description: description(cycle.periodStart)
    });

    await setInvoiceFromPayment(db, invoice.id, updated);
  };

  /**
   * Admin test: moves the store's pending invoice payment (set at close) to today, so Asaas charges the card now
   * instead of on the charge day. Returns false when no invoice has a pending payment.
   */
  export const chargeNow = async (db: DbClient, config: AsaasConfig, storeId: string, now: Date) => {
    const {
      records: [invoice]
    } = await db.billing_invoices.findMany({
      select: { id: true, period_start: true, amount_cents: true, asaas_payment_id: true },
      where: { store_id: storeId, status: InvoiceStatus.Pending, asaas_payment_id: { isNull: false } },
      order: { period_start: Order.Desc },
      take: 1
    });

    if (!invoice?.asaas_payment_id) {
      return false;
    }

    const today = localToday(now);

    const payment = await AsaasClient.updatePayment(config, {
      paymentId: invoice.asaas_payment_id,
      valueCents: invoice.amount_cents,
      dueDate: today,
      description: description(invoice.period_start)
    });

    await db.billing_invoices.updateOne({ data: { due_date: today }, where: { id: invoice.id } });
    await setInvoiceFromPayment(db, invoice.id, payment);

    return true;
  };

  /**
   * Asaas payment event. Idempotent; a paid invoice never goes back; unknown payments are ignored.
   */
  export const applyWebhook = async (
    db: DbClient,
    input: { event: string; paymentId: string; invoiceUrl: string | null; now: Date }
  ) => {
    const change = WEBHOOK_EVENTS[input.event];

    if (!change) {
      return;
    }

    const {
      records: [invoice]
    } = await db.billing_invoices.findMany({
      select: { id: true, store_id: true, status: true },
      where: { asaas_payment_id: input.paymentId },
      take: 1
    });

    if (!invoice || invoice.status === InvoiceStatus.Paid) {
      return;
    }

    const at = input.now.toISOString();

    await db.billing_invoices.updateOne({
      data: {
        status: change.status,
        failure_reason: change.reason,
        ...(input.invoiceUrl && { invoice_url: input.invoiceUrl }),
        ...(change.status === InvoiceStatus.Paid && { paid_at: at }),
        updated_at: at
      },
      where: { id: invoice.id }
    });

    if (change.status === InvoiceStatus.Paid) {
      await unblockIfPaid(db, invoice.store_id);
    }

    if (change.status === InvoiceStatus.Overdue) {
      const store = await db.stores.findOne({ select: { name: true }, where: { id: invoice.store_id } });

      await notifyAdmin(`Cobrança recusada (${change.reason}): ${store?.name ?? ''} ${invoice.store_id}`);
    }
  };
}
