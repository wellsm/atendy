import type { Db } from '../../src/db';

import { deepEqual, equal, notEqual } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { BillingAccounts } from '../../src/payments/accounts';
import { seedStore } from '../support/fixtures';

describe('BillingAccounts', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  const accountIdOf = async (storeId: string) => {
    const store = await db.stores.findOne({ select: { billing_account_id: true }, where: { id: storeId } });

    return store?.billing_account_id ?? null;
  };

  const withLegacyCard = (storeId: string, subscriptionId: string) =>
    db.stores.updateOne({
      data: {
        asaas_customer_id: `cus_${subscriptionId}`,
        asaas_subscription_id: subscriptionId,
        card_brand: 'VISA',
        card_last4: '1111'
      },
      where: { id: storeId }
    });

  it('gives a store its own account once, with the card it already had', async () => {
    const { storeId } = await seedStore(db);
    await withLegacyCard(storeId, 'sub_a');

    const first = await BillingAccounts.ensure(db, storeId);
    const second = await BillingAccounts.ensure(db, storeId);

    equal(second.id, first.id);
    equal(await accountIdOf(storeId), first.id);
    deepEqual(
      [first.owner_user_id, first.asaas_customer_id, first.asaas_subscription_id, first.card_brand, first.card_last4],
      [null, 'cus_sub_a', 'sub_a', 'VISA', '1111']
    );
  });

  it('puts every store of a user in one account; the first user given a store keeps it', async () => {
    const owner = `user_${randomUUID()}`;
    const { storeId: first } = await seedStore(db);
    const { storeId: second } = await seedStore(db);

    // The second store had its own account (e.g. it was billed before the owner was known).
    await BillingAccounts.ensure(db, second);

    await BillingAccounts.assignOwner(db, first, owner);
    await BillingAccounts.assignOwner(db, second, owner);

    const account = await accountIdOf(first);

    equal(await accountIdOf(second), account);
    equal((await BillingAccounts.ensure(db, first)).owner_user_id, owner);

    await BillingAccounts.assignOwner(db, first, `user_${randomUUID()}`);

    equal(await accountIdOf(first), account);
  });

  it('moves the joining store card to an account without one', async () => {
    const owner = `user_${randomUUID()}`;
    const { storeId: first } = await seedStore(db);
    const { storeId: second } = await seedStore(db);

    await withLegacyCard(second, 'sub_b');
    await BillingAccounts.assignOwner(db, first, owner);
    await BillingAccounts.assignOwner(db, second, owner);

    const account = await BillingAccounts.ensure(db, first);

    equal(await accountIdOf(second), account.id);
    equal(account.asaas_subscription_id, 'sub_b');
  });

  it('keeps a store in its own account when both accounts already have a card', async () => {
    mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}')));

    const owner = `user_${randomUUID()}`;
    const { storeId: first } = await seedStore(db);
    const { storeId: second } = await seedStore(db);

    await withLegacyCard(first, 'sub_c');
    await withLegacyCard(second, 'sub_d');
    await BillingAccounts.assignOwner(db, first, owner);
    await BillingAccounts.assignOwner(db, second, owner);

    notEqual(await accountIdOf(second), await accountIdOf(first));
    equal((await BillingAccounts.ensure(db, second)).asaas_subscription_id, 'sub_d');
  });
});
