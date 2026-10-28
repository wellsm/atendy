import type { Db } from '../../src/db';

import { equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { closeCashSessionHandler } from '../../src/cash/endpoints/close-session';
import { createCashMovementHandler } from '../../src/cash/endpoints/create-movement';
import { getCashCurrentHandler } from '../../src/cash/endpoints/get-current';
import { getCashSessionHandler } from '../../src/cash/endpoints/get-session';
import { listCashSessionsHandler } from '../../src/cash/endpoints/list-sessions';
import { openCashSessionHandler } from '../../src/cash/endpoints/open-session';
import { CashMovementKind } from '../../src/cash/types';
import { seedStore } from '../support/fixtures';

describe('panel cash endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, identity: { userId: 'user_1', orgId } };
  };

  const open = async (identity: { userId: string; orgId: string }, floatCents: number) => {
    return (await openCashSessionHandler({ identity, body: { floatCents } } as never, { db })).body.session;
  };

  const withField = (type: Function, field: string) => (error: unknown) =>
    error instanceof type && (error as HttpBadRequestError).context?.field === field;

  it('hides the expected amount while blind close is on', async () => {
    const { storeId, identity } = await setup();

    await db.stores.updateOne({ data: { pos_blind_close: true }, where: { id: storeId } });

    const session = await open(identity, 10000);

    await createCashMovementHandler(
      { identity, body: { kind: CashMovementKind.Sangria, amountCents: 2000, reason: 'Depósito' } } as never,
      { db }
    );

    const current = (await getCashCurrentHandler({ identity } as never, { db })).body;

    equal(current.session?.id, session.id);
    equal(current.report?.sangriaCents, 2000);
    equal(current.report?.expectedCashCents, null);

    const detail = await getCashSessionHandler({ identity, parameters: { sessionId: session.id } } as never, { db });

    equal(detail.body.report.expectedCashCents, null);

    const closed = await closeCashSessionHandler(
      { identity, parameters: { sessionId: session.id }, body: { countedCents: 8100 } } as never,
      { db }
    );

    equal(closed.body.report.expectedCashCents, 8000);
    equal(closed.body.report.differenceCents, 100);

    const after = await getCashSessionHandler({ identity, parameters: { sessionId: session.id } } as never, { db });

    equal(after.body.report.expectedCashCents, 8000);
    equal(after.body.session.countedCents, 8100);

    equal((await getCashCurrentHandler({ identity } as never, { db })).body.session, null);
  });

  it('maps drawer errors to 409 and input errors to 400', async () => {
    const { identity } = await setup();

    await rejects(
      createCashMovementHandler(
        { identity, body: { kind: CashMovementKind.Suprimento, amountCents: 100, reason: 'Troco' } } as never,
        { db }
      ),
      withField(HttpConflictError, 'no_session')
    );

    await rejects(open(identity, -1), withField(HttpBadRequestError, 'amount'));

    const session = await open(identity, 0);

    await rejects(open(identity, 0), withField(HttpConflictError, 'session_open'));

    await rejects(
      createCashMovementHandler(
        { identity, body: { kind: CashMovementKind.Suprimento, amountCents: 100, reason: '' } } as never,
        { db }
      ),
      withField(HttpBadRequestError, 'reason')
    );

    await closeCashSessionHandler(
      { identity, parameters: { sessionId: session.id }, body: { countedCents: 0 } } as never,
      { db }
    );

    await rejects(
      closeCashSessionHandler({ identity, parameters: { sessionId: session.id }, body: { countedCents: 0 } } as never, {
        db
      }),
      withField(HttpConflictError, 'already_closed')
    );
  });

  it('lists closed sessions newest first and hides other stores', async () => {
    const { identity } = await setup();
    const other = await setup();
    const ids: string[] = [];

    for (const floatCents of [100, 200]) {
      const session = await open(identity, floatCents);

      await closeCashSessionHandler(
        { identity, parameters: { sessionId: session.id }, body: { countedCents: floatCents } } as never,
        { db }
      );

      ids.push(session.id);
    }

    await open(identity, 300);

    const page = await listCashSessionsHandler({ identity, query: {} } as never, { db });

    equal(page.body.sessions.length, 2);
    equal(page.body.sessions[0]!.id, ids[1]);
    equal(page.body.next, null);

    await rejects(
      getCashSessionHandler({ identity: other.identity, parameters: { sessionId: ids[0] } } as never, { db }),
      HttpNotFoundError
    );

    await rejects(
      listCashSessionsHandler({ identity, query: { before: 'nope' } } as never, { db }),
      withField(HttpBadRequestError, 'before')
    );
  });

  it('refuses to open the caixa of a blocked store', async () => {
    const { storeId, identity } = await setup();

    await db.stores.updateOne({ data: { billing_blocked: true }, where: { id: storeId } });

    await rejects(open(identity, 0), withField(HttpForbiddenError, 'store_blocked'));

    equal((await getCashCurrentHandler({ identity } as never, { db })).body.session, null);
  });
});
