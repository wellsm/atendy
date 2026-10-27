import type { Db } from '../../src/db';

import { equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { getBillingHandler } from '../../src/panel/endpoints/get-billing';
import { updateBillingCardHandler } from '../../src/panel/endpoints/update-billing-card';
import { asaasWebhookHandler } from '../../src/payments/endpoints/asaas-webhook';
import { seedStore } from '../support/fixtures';

describe('payments endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const storeWithOrg = async () => {
    const { storeId } = await seedStore(db);
    const orgId = `org_${randomUUID()}`;

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, identity: { userId: 'user_1', orgId } };
  };

  const body = {
    holder: {
      name: 'Maria Souza',
      cpfCnpj: '12345678909',
      email: 'maria@example.com',
      phone: '11988887777',
      postalCode: '01310100',
      addressNumber: '100'
    },
    card: { holderName: 'MARIA SOUZA', number: '4111111111111111', expiryMonth: '05', expiryYear: '2030', ccv: '123' }
  };

  it('refuses the Asaas webhook without its token and ignores unknown payloads', async () => {
    const call = (token: string | undefined, payload: unknown) =>
      asaasWebhookHandler({ headers: { 'asaas-access-token': token }, body: payload } as never, { db });

    await rejects(call('wrong', {}), HttpUnauthorizedError);
    await rejects(call(undefined, {}), HttpUnauthorizedError);
    equal((await call('test', { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_unknown' } })).status, 200);
    equal((await call('test', { hello: 'world' })).status, 200);
  });

  it('names the card field to fix and turns an Asaas refusal into a generic 400', async () => {
    const { identity } = await storeWithOrg();
    const call = (input: typeof body) =>
      updateBillingCardHandler(
        { identity, headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }, body: input } as never,
        {
          db
        }
      );

    await rejects(call({ ...body, card: { ...body.card, number: '1234' } }), (error: unknown) => {
      equal(error instanceof HttpBadRequestError && error.context?.field, 'card.number');
      return true;
    });

    const fetch = mock.method(globalThis, 'fetch', (url: string) =>
      Promise.resolve(
        url.endsWith('/customers')
          ? new Response(JSON.stringify({ id: 'cus_1' }))
          : new Response(JSON.stringify({ errors: [{ code: 'invalid_creditCard', description: 'Não autorizada' }] }), {
              status: 400
            })
      )
    );

    await rejects(call(body), (error: unknown) => {
      equal(error instanceof HttpBadRequestError && error.context?.field, 'card');
      return true;
    });

    const subscription = JSON.parse((fetch.mock.calls[1]!.arguments[1] as RequestInit).body as string) as {
      remoteIp: string;
    };

    equal(subscription.remoteIp, '203.0.113.10');

    const { body: summary } = await getBillingHandler({ identity } as never, { db });

    equal(summary.card, null);
    equal(summary.priceCents, 50);
  });
});
