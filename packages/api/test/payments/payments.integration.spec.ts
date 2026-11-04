import type { Db } from '../../src/db';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { BillingOutcome } from '../../src/billing/types';
import { BillingAccounts } from '../../src/payments/accounts';
import { PaymentsRepository } from '../../src/payments/repository';
import { InvoiceStatus } from '../../src/payments/types';
import { seedConversation, seedStore } from '../support/fixtures';

const CONFIG = { apiUrl: 'http://asaas.test', apiKey: 'test' };

// Nov 2nd 2026, 09:00 in Brazil: October's cycle is closed, charge date Nov 5th.
const NOV_2 = new Date('2026-11-02T12:00:00Z');

type Call = { method: string; path: string; body: Record<string, unknown> | null };

/**
 * Fake Asaas: records every call and answers by path.
 */
const fakeAsaas = (answers: Record<string, unknown> = {}) => {
  const calls: Call[] = [];

  mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    const path = url.replace(CONFIG.apiUrl, '');
    const method = init.method ?? 'GET';

    calls.push({ method, path, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });

    const key = `${method} ${path.split('?')[0]}`;
    const answer = answers[key] ?? { id: `id-${calls.length}`, status: 'PENDING' };

    return Promise.resolve(answer instanceof Response ? answer : new Response(JSON.stringify(answer), { status: 200 }));
  });

  return calls;
};

describe('PaymentsRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const holder = {
    name: 'Maria Souza',
    cpfCnpj: '12345678909',
    email: 'maria@example.com',
    phone: '11988887777',
    postalCode: '01310100',
    addressNumber: '100'
  };

  const card = {
    holderName: 'MARIA SOUZA',
    number: '4111111111111111',
    expiryMonth: '05',
    expiryYear: '2030',
    ccv: '123'
  };

  /**
   * One billing row per amount, created inside October 2026 (Brazil).
   */
  const seedUsage = async (storeId: string, amounts: number[], createdAt = '2026-10-15T15:00:00.000Z') => {
    const { conversationId } = await seedConversation(db, storeId);

    for (const amount of amounts) {
      await db.billing_records.insertOne({
        data: {
          id: randomUUID(),
          store_id: storeId,
          conversation_id: conversationId,
          outcome: BillingOutcome.Placed,
          steps: [],
          percent: 100,
          price_cents: amount,
          amount_cents: amount,
          created_at: createdAt,
          updated_at: createdAt
        }
      });
    }

    return conversationId;
  };

  const invoicesOf = async (storeId: string) => {
    const { records } = await db.billing_invoices.findMany({
      select: { id: true, amount_cents: true, orders: true, status: true, due_date: true, asaas_payment_id: true },
      where: { store_id: storeId }
    });

    return records;
  };

  const withSubscription = (storeId: string) =>
    db.stores.updateOne({
      data: { asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1', card_brand: 'VISA', card_last4: '1111' },
      where: { id: storeId }
    });

  it('closes the month, marks the records and sets the subscription payment to the real amount', async () => {
    const { storeId } = await seedStore(db);
    await withSubscription(storeId);
    await seedUsage(storeId, [500, 500, 250]);
    // November usage stays open.
    await seedUsage(storeId, [500], '2026-11-01T12:00:00.000Z');

    const calls = fakeAsaas({
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_nov', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      },
      'PUT /payments/pay_nov': {
        id: 'pay_nov',
        status: 'PENDING',
        value: 12.5,
        dueDate: '2026-11-05',
        invoiceUrl: 'https://asaas.test/i/1'
      }
    });

    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    const [invoice] = await invoicesOf(storeId);

    equal(invoice?.amount_cents, 1250);
    equal(invoice?.orders, 3);
    equal(invoice?.due_date, '2026-11-05');
    equal(invoice?.asaas_payment_id, 'pay_nov');
    deepEqual(
      calls.map(({ method, path }) => `${method} ${path.split('?')[0]}`),
      ['GET /subscriptions/sub_1/payments', 'PUT /payments/pay_nov']
    );
    equal(calls[1]?.body?.value, 12.5);

    const summary = await PaymentsRepository.summary(db, storeId);

    deepEqual(summary?.open, { orders: 1, amountCents: 500 });

    // Idempotent: a second run the same day touches nothing.
    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    equal((await invoicesOf(storeId)).length, 1);
    equal(calls.length, 2);
  });

  it('charges every store of an account once, with the total and each store in the description', async () => {
    const owner = `user_${randomUUID()}`;
    const { storeId: sales } = await seedStore(db);
    const { storeId: bookings } = await seedStore(db);

    await db.stores.updateOne({ data: { name: 'Bella Loja' }, where: { id: sales } });
    await db.stores.updateOne({ data: { name: 'Bella Agenda' }, where: { id: bookings } });

    await withSubscription(sales);
    await BillingAccounts.assignOwner(db, sales, owner);
    await BillingAccounts.assignOwner(db, bookings, owner);
    // Each store alone stays below the minimum charge; the account does not.
    await seedUsage(sales, [600]);
    await seedUsage(bookings, [500]);

    const calls = fakeAsaas({
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_acc', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      },
      'PUT /payments/pay_acc': { id: 'pay_acc', status: 'PENDING', value: 11, dueDate: '2026-11-05' }
    });

    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [sales]);

    deepEqual(
      calls.map(({ method, path }) => `${method} ${path.split('?')[0]}`),
      ['GET /subscriptions/sub_1/payments', 'PUT /payments/pay_acc']
    );
    equal(calls[1]?.body?.value, 11);
    ok(String(calls[1]?.body?.description).includes('Bella Loja: R$ 6,00'));
    ok(String(calls[1]?.body?.description).includes('Bella Agenda: R$ 5,00'));

    for (const [storeId, amount] of [
      [sales, 600],
      [bookings, 500]
    ] as const) {
      const [invoice] = await invoicesOf(storeId);

      equal(invoice?.amount_cents, amount);
      equal(invoice?.asaas_payment_id, 'pay_acc');
    }

    // Either store's panel shows the whole account.
    const summary = await PaymentsRepository.summary(db, bookings);

    deepEqual(summary?.card, { brand: 'VISA', last4: '1111' });
    deepEqual(summary?.invoices.map(({ storeName, amountCents }) => [storeName, amountCents]).sort(), [
      ['Bella Agenda', 500],
      ['Bella Loja', 600]
    ]);

    // A refused charge blocks both stores after the grace days; paying lifts both.
    const event = (name: string) =>
      PaymentsRepository.applyWebhook(db, { event: name, paymentId: 'pay_acc', invoiceUrl: null, now: NOV_2 });

    await event('PAYMENT_OVERDUE');
    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-13T12:00:00Z'), [sales]);

    equal((await PaymentsRepository.summary(db, bookings))?.blocked, true);
    equal((await PaymentsRepository.summary(db, sales))?.blocked, true);

    await event('PAYMENT_RECEIVED');

    equal((await PaymentsRepository.summary(db, bookings))?.blocked, false);
    equal((await PaymentsRepository.summary(db, sales))?.blocked, false);
  });

  it('adds the invoice of a store that joined after the close to the account payment', async () => {
    const owner = `user_${randomUUID()}`;
    const { storeId: sales } = await seedStore(db);
    const { storeId: joiner } = await seedStore(db);

    await withSubscription(sales);
    await BillingAccounts.assignOwner(db, sales, owner);
    await seedUsage(sales, [2000]);
    await seedUsage(joiner, [1500]);

    const subscription = {
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_j', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      },
      'PUT /payments/pay_j': { id: 'pay_j', status: 'PENDING', value: 20, dueDate: '2026-11-05' }
    };

    // Both close on their own: the joiner had no card, so its invoice has no payment.
    fakeAsaas(subscription);
    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [sales, joiner]);
    await BillingAccounts.assignOwner(db, joiner, owner);

    const calls = fakeAsaas(subscription);

    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-03T12:00:00Z'), [sales]);

    equal(calls.find(({ method }) => method === 'PUT')?.body?.value, 35);
    equal((await invoicesOf(joiner))[0]?.asaas_payment_id, 'pay_j');
  });

  it('carries a small month over and deletes the placeholder charge', async () => {
    const { storeId } = await seedStore(db);
    await withSubscription(storeId);
    await seedUsage(storeId, [300]);

    const calls = fakeAsaas({
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_nov', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      }
    });

    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    equal((await invoicesOf(storeId)).length, 0);
    ok(calls.some(({ method, path }) => method === 'DELETE' && path === '/payments/pay_nov'));
    deepEqual((await PaymentsRepository.summary(db, storeId))?.open, { orders: 1, amountCents: 300 });
  });

  it('bills only the raise of a record already invoiced', async () => {
    const { storeId } = await seedStore(db);
    const conversationId = await seedUsage(storeId, [2000]);

    fakeAsaas();
    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    // A handoff record (40 %) later placed by the bot: raised to 100 % after the close.
    await db.billing_records.updateMany({
      data: { amount_cents: 3000, updated_at: '2026-11-10T12:00:00.000Z' },
      where: { conversation_id: conversationId }
    });

    deepEqual((await PaymentsRepository.summary(db, storeId))?.open, { orders: 1, amountCents: 1000 });
  });

  it('marks an invoice without card overdue on its date and blocks the store after the grace days', async () => {
    const { storeId } = await seedStore(db);
    await seedUsage(storeId, [2000]);

    const telegram = fakeAsaas();

    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);
    equal((await invoicesOf(storeId))[0]?.status, InvoiceStatus.Pending);

    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-05T12:00:00Z'), [storeId]);
    equal((await invoicesOf(storeId))[0]?.status, InvoiceStatus.Overdue);

    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-12T12:00:00Z'), [storeId]);
    equal((await PaymentsRepository.summary(db, storeId))?.blocked, false);

    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-13T12:00:00Z'), [storeId]);
    equal((await PaymentsRepository.summary(db, storeId))?.blocked, true);
    ok(telegram.some(({ path }) => path.includes('api.telegram.org')));
  });

  it('registers the card through a subscription and charges the invoice already due', async () => {
    const { storeId } = await seedStore(db);
    await seedUsage(storeId, [2000]);

    fakeAsaas();
    await PaymentsRepository.runDaily(db, CONFIG, new Date('2026-11-14T12:00:00Z'), [storeId]);
    equal((await PaymentsRepository.summary(db, storeId))?.blocked, true);

    const calls = fakeAsaas({
      'POST /customers': { id: 'cus_9' },
      'POST /subscriptions': { id: 'sub_9', creditCard: { creditCardNumber: '1111', creditCardBrand: 'VISA' } },
      'POST /payments': { id: 'pay_9', status: 'CONFIRMED', value: 20, dueDate: '2026-11-14', invoiceUrl: null }
    });

    await PaymentsRepository.registerCard(db, CONFIG, {
      storeId,
      holder,
      card,
      remoteIp: '203.0.113.10',
      now: new Date('2026-11-14T12:00:00Z')
    });

    deepEqual(
      calls.map(({ method, path }) => `${method} ${path}`),
      ['POST /customers', 'POST /subscriptions', 'POST /payments']
    );
    equal(calls[1]?.body?.nextDueDate, '2026-12-05');
    equal(calls[1]?.body?.remoteIp, '203.0.113.10');

    const summary = await PaymentsRepository.summary(db, storeId);

    deepEqual(summary?.card, { brand: 'VISA', last4: '1111' });
    equal(summary?.blocked, false);
    equal(summary?.invoices[0]?.status, InvoiceStatus.Paid);
  });

  it('moves the pending invoice payment to today on an admin charge now', async () => {
    const { storeId } = await seedStore(db);
    await withSubscription(storeId);

    fakeAsaas();
    equal(await PaymentsRepository.chargeNow(db, CONFIG, storeId, NOV_2), false);

    await seedUsage(storeId, [2000]);
    fakeAsaas({
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_c', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      },
      'PUT /payments/pay_c': { id: 'pay_c', status: 'PENDING', value: 20, dueDate: '2026-11-05' }
    });
    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    const calls = fakeAsaas({
      'PUT /payments/pay_c': { id: 'pay_c', status: 'PENDING', value: 20, dueDate: '2026-11-02' }
    });

    equal(await PaymentsRepository.chargeNow(db, CONFIG, storeId, NOV_2), true);
    deepEqual(
      calls.map(({ method, path, body }) => [`${method} ${path}`, body?.value, body?.dueDate]),
      [['PUT /payments/pay_c', 20, '2026-11-02']]
    );
    equal((await invoicesOf(storeId))[0]?.due_date, '2026-11-02');
  });

  it('applies Asaas events idempotently and never reopens a paid invoice', async () => {
    const { storeId } = await seedStore(db);
    await withSubscription(storeId);
    await seedUsage(storeId, [2000]);

    fakeAsaas({
      'GET /subscriptions/sub_1/payments': {
        data: [{ id: 'pay_w', status: 'PENDING', value: 10, dueDate: '2026-11-05' }]
      },
      'PUT /payments/pay_w': { id: 'pay_w', status: 'PENDING', value: 20, dueDate: '2026-11-05' }
    });
    await PaymentsRepository.runDaily(db, CONFIG, NOV_2, [storeId]);

    const event = (name: string) =>
      PaymentsRepository.applyWebhook(db, {
        event: name,
        paymentId: 'pay_w',
        invoiceUrl: 'https://asaas.test/i/w',
        now: NOV_2
      });

    await event('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED');
    equal((await PaymentsRepository.summary(db, storeId))?.invoices[0]?.failureReason, 'card_refused');

    await event('PAYMENT_CONFIRMED');
    await event('PAYMENT_CONFIRMED');
    await event('PAYMENT_OVERDUE');

    const [invoice] = (await PaymentsRepository.summary(db, storeId))!.invoices;

    equal(invoice?.status, InvoiceStatus.Paid);
    equal(invoice?.invoiceUrl, 'https://asaas.test/i/w');
  });
});
