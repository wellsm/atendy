import { deepEqual, rejects } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';

import { adminAuthorizer } from '../../src/admin/authorizer';
import { signClerkToken } from '../support/clerk';

describe('adminAuthorizer', () => {
  const authorize = (authorization?: string) => adminAuthorizer({ headers: { authorization } }, {} as never);

  afterEach(() => {
    delete process.env.ADMIN_USER_IDS;
  });

  it('accepts a user listed in ADMIN_USER_IDS', async () => {
    process.env.ADMIN_USER_IDS = 'user_other, user_admin';

    const { identity } = await authorize(await signClerkToken({ sub: 'user_admin' }));

    deepEqual(identity, { userId: 'user_admin' });
  });

  it('forbids a valid user that is not listed, and everyone when the list is empty', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin';

    await rejects(authorize(await signClerkToken({ sub: 'user_store' })), HttpForbiddenError);

    process.env.ADMIN_USER_IDS = '';

    await rejects(authorize(await signClerkToken({ sub: 'user_admin' })), HttpForbiddenError);
  });

  it('rejects an invalid token before checking the list', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin';

    await rejects(authorize('Bearer nope'), HttpUnauthorizedError);
  });
});
