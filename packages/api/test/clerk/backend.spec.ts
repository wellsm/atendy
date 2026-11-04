import { deepEqual, equal, rejects } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { ClerkBackend, ClerkRequestError } from '../../src/clerk/backend';

type Call = { method: string; url: string; body: unknown };

/**
 * Answers Clerk requests by `METHOD path` and records every call.
 */
const mockClerk = (routes: Record<string, unknown>) => {
  const calls: Call[] = [];

  mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname.replace('/v1', '');

    calls.push({ method, url, body: init.body ? JSON.parse(init.body as string) : undefined });

    const key = `${method} ${path}`;

    if (!(key in routes)) {
      return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'not found' }] }), { status: 404 }));
    }

    return Promise.resolve(new Response(JSON.stringify(routes[key] ?? {}), { status: 200 }));
  });

  return calls;
};

const memberships = (...orgIds: string[]) => ({
  data: orgIds.map((id) => ({ organization: { id } })),
  total_count: orgIds.length
});

describe('Clerk backend', () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = 'sk_test_x';
    ClerkBackend.clearCache();
  });

  afterEach(() => mock.restoreAll());

  it('creates an org without a creator and returns its id', async () => {
    const calls = mockClerk({ 'POST /organizations': { id: 'org_new' } });

    equal(await ClerkBackend.createOrg('Pizzaria Demo'), 'org_new');
    deepEqual(calls[0]?.body, { name: 'Pizzaria Demo' });
  });

  it('creates a user by email without a password', async () => {
    const calls = mockClerk({ 'POST /users': { id: 'user_new' } });

    equal(await ClerkBackend.createUser('ana+clerk_test@example.com'), 'user_new');
    deepEqual(calls[0]?.body, { email_address: ['ana+clerk_test@example.com'], skip_password_requirement: true });
  });

  it('sets the orgs of a user: adds the missing ones as admin and removes the rest', async () => {
    const calls = mockClerk({
      'GET /users/user_1/organization_memberships': memberships('org_a', 'org_c'),
      'POST /organizations/org_b/memberships': {},
      'DELETE /organizations/org_a/memberships/user_1': {}
    });

    await ClerkBackend.setUserOrgs('user_1', ['org_b', 'org_c']);

    const writes = calls.filter(({ method }) => method !== 'GET');

    deepEqual(
      writes.map(({ method, url, body }) => [method, new URL(url).pathname, body]),
      [
        ['POST', '/v1/organizations/org_b/memberships', { user_id: 'user_1', role: 'org:admin' }],
        ['DELETE', '/v1/organizations/org_a/memberships/user_1', undefined]
      ]
    );
  });

  it('lists users with their primary email and orgs', async () => {
    mockClerk({
      'GET /users': [
        {
          id: 'user_1',
          primary_email_address_id: 'e2',
          email_addresses: [
            { id: 'e1', email_address: 'old@example.com' },
            { id: 'e2', email_address: 'ana@example.com' }
          ]
        }
      ],
      'GET /users/user_1/organization_memberships': memberships('org_a')
    });

    deepEqual(await ClerkBackend.listUsers(), [{ id: 'user_1', email: 'ana@example.com', orgIds: ['org_a'] }]);
  });

  it('caches the orgs of a user until the cache is cleared', async () => {
    const calls = mockClerk({ 'GET /users/user_1/organization_memberships': memberships('org_a') });

    deepEqual(await ClerkBackend.userOrgIds('user_1'), ['org_a']);
    deepEqual(await ClerkBackend.userOrgIds('user_1'), ['org_a']);
    equal(calls.length, 1);

    ClerkBackend.clearCache();
    await ClerkBackend.userOrgIds('user_1');
    equal(calls.length, 2);
  });

  it('sends the secret key and throws on an error answer', async () => {
    mockClerk({});

    await rejects(
      ClerkBackend.deleteUser('user_x'),
      (error) => error instanceof ClerkRequestError && error.status === 404
    );

    const [, init] = (globalThis.fetch as unknown as { mock: { calls: { arguments: [string, RequestInit] }[] } }).mock
      .calls[0]!.arguments;

    equal((init.headers as Record<string, string>).Authorization, 'Bearer sk_test_x');
  });
});
