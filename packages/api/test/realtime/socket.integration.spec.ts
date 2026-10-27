import type { Db } from '../../src/db';
import type { RealtimeDb } from '../../src/realtime-db';

import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { panelSocketConnectHandler } from '../../src/realtime/actions/connect';
import { panelSocketDisconnectHandler } from '../../src/realtime/actions/disconnect';
import { panelSocketMessageHandler } from '../../src/realtime/actions/message';
import { panelSocketAuthorizer } from '../../src/realtime/authorizer';
import { ConnectionRepository } from '../../src/realtime/repository';
import { PanelSocketMessageType } from '../../src/realtime/types';
import { signClerkToken } from '../support/clerk';
import { seedStore } from '../support/fixtures';

describe('panel socket', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const realtimeDb = DatabaseTester.getClient<RealtimeDb>('RealtimeDb');

  const seedOrgStore = async (orgId: string) => {
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    return { storeId, slug: `t-${storeId}` };
  };

  // The browser sends the bare token in the query string, not an Authorization header.
  const tokenFor = async (claims: Record<string, unknown>) => (await signClerkToken(claims)).slice('Bearer '.length);

  const authorize = (token: string, slug: string) => panelSocketAuthorizer({ query: { token, slug } }, { db });

  it("authorizes a token whose org owns the slug's store", async () => {
    const { storeId, slug } = await seedOrgStore('org_socket_a');

    const { identity } = await authorize(await tokenFor({ sub: 'user_a', o: { id: 'org_socket_a' } }), slug);

    deepEqual(identity, { userId: 'user_a', storeId });
  });

  it("refuses another store's slug, an org without store and a token without org", async () => {
    await seedOrgStore('org_socket_b');
    const other = await seedOrgStore('org_socket_c');

    await rejects(authorize(await tokenFor({ o: { id: 'org_socket_b' } }), other.slug), HttpForbiddenError);
    await rejects(authorize(await tokenFor({ o: { id: 'org_without_store' } }), other.slug), HttpForbiddenError);
    await rejects(authorize(await tokenFor({}), other.slug), HttpForbiddenError);
  });

  it('refuses an invalid token', async () => {
    const { slug } = await seedOrgStore('org_socket_d');

    await rejects(authorize('not-a-token', slug), HttpUnauthorizedError);
  });

  it('connect writes the row and disconnect removes it', async () => {
    const identity = { userId: 'user_e', storeId: 'store-socket-e' };

    await panelSocketConnectHandler({ connectionId: 'conn-e', identity } as never, { realtimeDb });

    deepEqual(await ConnectionRepository.listByStore(realtimeDb, 'store-socket-e'), ['conn-e']);

    await panelSocketDisconnectHandler({ connectionId: 'conn-e' } as never, { realtimeDb });

    deepEqual(await ConnectionRepository.listByStore(realtimeDb, 'store-socket-e'), []);
  });

  it('answers alive with ack', () => {
    const response = panelSocketMessageHandler({ body: { type: PanelSocketMessageType.Alive } } as never);

    deepEqual(response, { body: { type: PanelSocketMessageType.Ack } });
  });
});
