import { deepEqual, equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpUnauthorizedError } from '@ez4/gateway';

import { panelAuthorizer } from '../../src/panel/authorizer';
import { signClerkToken } from '../support/clerk';

describe('panelAuthorizer', () => {
  const authorize = (authorization?: string) => panelAuthorizer({ headers: { authorization } }, {} as never);

  it('returns the user and the active org of a v2 session token', async () => {
    const { identity } = await authorize(await signClerkToken({ sub: 'user_1', o: { id: 'org_1', rol: 'admin' } }));

    deepEqual(identity, { userId: 'user_1', orgId: 'org_1' });
  });

  it('reads the org of a v1 session token', async () => {
    const { identity } = await authorize(await signClerkToken({ sub: 'user_1', v: undefined, org_id: 'org_v1' }));

    deepEqual(identity, { userId: 'user_1', orgId: 'org_v1' });
  });

  it('authorizes a user without an org (onboarding)', async () => {
    const { identity } = await authorize(await signClerkToken({ sub: 'user_2' }));

    deepEqual(identity, { userId: 'user_2' });
  });

  it('reads the first factor age (`fva[0]`) and ignores unknown ages', async () => {
    const recent = await authorize(await signClerkToken({ sub: 'user_1', o: { id: 'org_1' }, fva: [3, -1] }));
    const unknown = await authorize(await signClerkToken({ sub: 'user_1', fva: [-1, -1] }));

    equal(recent.identity.factorAgeMinutes, 3);
    deepEqual(unknown.identity, { userId: 'user_1' });
  });

  it('rejects a missing, tampered or expired token', async () => {
    const valid = await signClerkToken();
    const expired = await signClerkToken({ iat: 1000, nbf: 1000, exp: 2000 });

    await rejects(authorize(undefined), HttpUnauthorizedError);
    await rejects(authorize('Bearer'), HttpUnauthorizedError);
    await rejects(authorize(`${valid.slice(0, -4)}AAAA`), HttpUnauthorizedError);
    await rejects(authorize(expired), HttpUnauthorizedError);
  });
});
