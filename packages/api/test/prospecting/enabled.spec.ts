import { deepEqual, rejects } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { HttpNotFoundError } from '@ez4/gateway';

import { prospectingSendHandler } from '../../src/prospecting/crons/send';
import { getProspectingHandler } from '../../src/prospecting/endpoints/get-prospecting';
import { importProspectsHandler } from '../../src/prospecting/endpoints/import-prospects';
import { prospectingWebhookHandler } from '../../src/prospecting/endpoints/webhook';

describe('prospecting turned off', () => {
  // Any property read fails the test: turned off, nothing may reach the database.
  const db = new Proxy(
    {},
    {
      get: () => {
        throw new Error('database touched');
      }
    }
  ) as never;

  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.PROSPECTING_ENABLED;
    process.env.PROSPECTING_ENABLED = 'false';
  });

  afterEach(() => {
    process.env.PROSPECTING_ENABLED = previous;
  });

  it('the cron returns without reading the database', async () => {
    await prospectingSendHandler(null as never, { db, variables: {} } as never);
  });

  it('the webhook acknowledges without reading the database', async () => {
    deepEqual(await prospectingWebhookHandler({ headers: {}, body: {} } as never, { db }), { status: 200 });
  });

  it('admin routes answer 404', async () => {
    const identity = { userId: 'user_admin' };

    await rejects(getProspectingHandler({ identity } as never, { db }), HttpNotFoundError);
    await rejects(importProspectsHandler({ identity, body: { leads: [] } } as never, { db }), HttpNotFoundError);
  });
});
