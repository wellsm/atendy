import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { createAdminStoreHandler } from '../../src/admin/endpoints/create-store';
import { createAdminUserHandler } from '../../src/admin/endpoints/create-user';
import { deleteAdminUserHandler } from '../../src/admin/endpoints/delete-user';
import { listAdminUsersHandler } from '../../src/admin/endpoints/list-users';
import { updateAdminUserStoresHandler } from '../../src/admin/endpoints/update-user-stores';
import { ClerkBackend } from '../../src/clerk/backend';
import { StoreRepository } from '../../src/stores/repository';
import { seedStore } from '../support/fixtures';

type Call = { method: string; path: string; body: unknown };

describe('admin stores and users (Clerk)', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const identity = { userId: 'user_admin' };

  beforeEach(() => ClerkBackend.clearCache());

  afterEach(() => mock.restoreAll());

  /**
   * Answers Clerk requests by `METHOD path` (without `/v1` and the query) and records every call.
   */
  const mockClerk = (routes: Record<string, unknown>) => {
    const calls: Call[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname.replace('/v1', '');

      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });

      const key = `${method} ${path}`;

      return Promise.resolve(
        key in routes
          ? new Response(JSON.stringify(routes[key] ?? {}), { status: 200 })
          : new Response(JSON.stringify({ errors: [{ message: 'not found' }] }), { status: 404 })
      );
    });

    return calls;
  };

  const memberships = (...orgIds: string[]) => ({ data: orgIds.map((id) => ({ organization: { id } })) });

  const storeWithOrg = async () => {
    const { storeId } = await seedStore(db);
    const orgId = `org_${randomUUID()}`;

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, orgId, slug: `t-${storeId}` };
  };

  /**
   * Owner of the billing account that pays for the store.
   */
  const payer = async (storeId: string) => {
    const store = await db.stores.findOne({ select: { billing_account_id: true }, where: { id: storeId } });
    const account = store?.billing_account_id
      ? await db.billing_accounts.findOne({ select: { owner_user_id: true }, where: { id: store.billing_account_id } })
      : undefined;

    return { accountId: store?.billing_account_id ?? null, owner: account?.owner_user_id ?? null };
  };

  const badField = (field: string) => (error: unknown) =>
    error instanceof HttpBadRequestError && error.context?.field === field;

  it('creates an active store with its own Clerk org', async () => {
    const orgId = `org_${randomUUID()}`;
    const calls = mockClerk({ 'POST /organizations': { id: orgId } });

    const response = await createAdminStoreHandler({ identity, body: { name: 'Pizzaria Demo' } } as never, { db });

    equal(response.status, 201);
    equal(response.body.store.name, 'Pizzaria Demo');
    deepEqual(calls[0], { method: 'POST', path: '/organizations', body: { name: 'Pizzaria Demo' } });

    const store = await db.stores.findOne({
      select: { active: true, clerk_org_id: true, slug: true },
      where: { id: response.body.store.id }
    });

    equal(store?.active, true);
    equal(store?.clerk_org_id, orgId);
    equal(store?.slug, response.body.store.slug);
  });

  it('refuses a taken slug before calling Clerk', async () => {
    const { slug } = await storeWithOrg();
    const calls = mockClerk({});

    await rejects(
      createAdminStoreHandler({ identity, body: { name: 'Outra', slug } } as never, { db }),
      HttpConflictError
    );

    equal(calls.length, 0);
  });

  it('deletes the new org when the store insert fails', async () => {
    const calls = mockClerk({ 'POST /organizations': { id: 'org_orphan' }, 'DELETE /organizations/org_orphan': {} });
    mock.method(StoreRepository, 'create', () => Promise.reject(new Error('insert failed')));

    await rejects(createAdminStoreHandler({ identity, body: { name: 'Outra' } } as never, { db }), /insert failed/);

    deepEqual(
      calls.map(({ method, path }) => `${method} ${path}`),
      ['POST /organizations', 'DELETE /organizations/org_orphan']
    );
  });

  it('refuses a reserved slug before calling Clerk', async () => {
    const calls = mockClerk({});

    await rejects(
      createAdminStoreHandler({ identity, body: { name: 'X', slug: 'admin' } } as never, { db }),
      badField('slug')
    );

    equal(calls.length, 0);
  });

  it('creates a user and makes it a member of each chosen store', async () => {
    const a = await storeWithOrg();
    const b = await storeWithOrg();
    const calls = mockClerk({
      'POST /users': { id: 'user_new' },
      'GET /users/user_new/organization_memberships': memberships(),
      [`POST /organizations/${a.orgId}/memberships`]: {},
      [`POST /organizations/${b.orgId}/memberships`]: {}
    });

    const response = await createAdminUserHandler(
      { identity, body: { email: 'ana+clerk_test@example.com', storeIds: [a.storeId, b.storeId] } } as never,
      { db }
    );

    equal(response.status, 201);
    equal(response.body.user.id, 'user_new');
    equal(response.body.user.email, 'ana+clerk_test@example.com');
    deepEqual(response.body.user.stores.map(({ id }) => id).sort(), [a.storeId, b.storeId].sort());
    equal(calls.filter(({ path }) => path.endsWith('/memberships')).length, 2);

    // Admin-created stores join the first user given them: one account pays for both.
    const [first, second] = [await payer(a.storeId), await payer(b.storeId)];

    equal(first.owner, 'user_new');
    equal(second.accountId, first.accountId);
  });

  it('changes the stores of a user', async () => {
    const a = await storeWithOrg();
    const b = await storeWithOrg();
    const calls = mockClerk({
      'GET /users/user_1': {
        id: 'user_1',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'joao@example.com' }]
      },
      'GET /users/user_1/organization_memberships': memberships(a.orgId, b.orgId),
      [`DELETE /organizations/${a.orgId}/memberships/user_1`]: {}
    });

    const response = await updateAdminUserStoresHandler(
      { identity, parameters: { userId: 'user_1' }, body: { storeIds: [b.storeId] } } as never,
      { db }
    );

    deepEqual(
      calls.filter(({ method }) => method === 'DELETE').map(({ path }) => path),
      [`/organizations/${a.orgId}/memberships/user_1`]
    );
    equal(response.body.user.email, 'joao@example.com');
    equal((await payer(b.storeId)).owner, 'user_1');
  });

  it('refuses a store id that does not exist or has no org', async () => {
    const { storeId } = await seedStore(db);
    mockClerk({});

    await rejects(
      createAdminUserHandler({ identity, body: { email: 'x@example.com', storeIds: [storeId] } } as never, { db }),
      badField('store_ids')
    );
  });

  it('lists users with their stores, leaving out orgs without a store', async () => {
    const a = await storeWithOrg();
    mockClerk({
      'GET /users': [
        {
          id: 'user_1',
          primary_email_address_id: 'e1',
          email_addresses: [{ id: 'e1', email_address: 'a@example.com' }]
        }
      ],
      'GET /users/user_1/organization_memberships': memberships(a.orgId, 'org_without_store')
    });

    const { body } = await listAdminUsersHandler({ identity } as never, { db });

    deepEqual(body.users, [
      { id: 'user_1', email: 'a@example.com', stores: [{ id: a.storeId, name: 'Pizzaria Teste', slug: a.slug }] }
    ]);
  });

  it('deletes a user', async () => {
    const calls = mockClerk({ 'DELETE /users/user_1': {} });

    const response = await deleteAdminUserHandler({ identity, parameters: { userId: 'user_1' } } as never, { db });

    deepEqual(response.body, { id: 'user_1' });
    deepEqual(
      calls.map(({ method, path }) => `${method} ${path}`),
      ['DELETE /users/user_1']
    );
  });
});
