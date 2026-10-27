import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { getCostReportHandler } from '../../src/admin/endpoints/get-cost-report';
import { AiPath, AiProvider } from '../../src/agent/types';
import { BillingOutcome } from '../../src/billing/types';
import { OrderStatus } from '../../src/orders/types';
import { seedConversation, seedStore } from '../support/fixtures';

/**
 * Isolated period far from other tests' data (they write "now").
 */
const FROM = '2020-03-01';
const TO = '2020-03-10';

describe('admin cost report', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const identity = { userId: 'user_admin' };

  const report = (query: object) => getCostReportHandler({ identity, query } as never, { db });

  const aiCall = async (
    storeId: string,
    conversationId: string,
    input: { at: string; costUsd: number; provider?: AiProvider; path?: AiPath }
  ) => {
    await db.ai_calls.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        conversation_id: conversationId,
        provider: input.provider ?? AiProvider.OpenRouter,
        model: input.provider === AiProvider.Jev ? 'jev' : 'test/model',
        path: input.path ?? AiPath.LlmFallback,
        input_tokens: 100,
        output_tokens: 10,
        cost_usd: input.costUsd,
        latency_ms: 1000,
        created_at: input.at
      }
    });
  };

  const order = async (
    scope: { storeId: string; conversationId: string; customerId: string },
    input: { placedAt: string | null; status: OrderStatus }
  ) => {
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.orders.insertOne({
      data: {
        id,
        store_id: scope.storeId,
        customer_id: scope.customerId,
        conversation_id: scope.conversationId,
        status: input.status,
        subtotal_cents: 5000,
        fee_cents: 0,
        total_cents: 5000,
        placed_at: input.placedAt,
        created_at: now,
        updated_at: now
      }
    });

    return id;
  };

  const setup = async () => {
    const { storeId } = await seedStore(db);
    const conversation = await seedConversation(db, storeId);

    return { storeId, scope: { storeId, ...conversation } };
  };

  it('reports one store inside the Sao Paulo period', async () => {
    const { storeId, scope } = await setup();
    const other = await setup();

    await aiCall(storeId, scope.conversationId, {
      at: '2020-03-05T15:00:00.000Z',
      costUsd: 0.0002,
      provider: AiProvider.Jev,
      path: AiPath.JevDirect
    });
    await aiCall(storeId, scope.conversationId, {
      at: '2020-03-05T15:00:01.000Z',
      costUsd: 0.001,
      path: AiPath.LlmReply
    });
    // 23:30 BRT on the last day: inside.
    await aiCall(storeId, scope.conversationId, { at: '2020-03-11T02:30:00.000Z', costUsd: 0.002 });
    // 00:30 BRT the day after: outside.
    await aiCall(storeId, scope.conversationId, { at: '2020-03-11T03:30:00.000Z', costUsd: 1 });
    await aiCall(other.storeId, other.scope.conversationId, { at: '2020-03-05T15:00:00.000Z', costUsd: 5 });

    await order(scope, { placedAt: '2020-03-11T01:00:00.000Z', status: OrderStatus.Done });
    await order(scope, { placedAt: '2020-03-06T20:00:00.000Z', status: OrderStatus.Canceled });
    await order(scope, { placedAt: '2020-03-11T04:00:00.000Z', status: OrderStatus.Done });
    await order(scope, { placedAt: null, status: OrderStatus.Draft });

    await db.conversations.updateOne({
      data: { handoff_reason: 'customer_asked' },
      where: { id: scope.conversationId }
    });

    const { body } = await report({ storeId, from: FROM, to: TO });

    deepEqual(body.period, { from: FROM, to: TO, days: 10 });
    equal(body.conversations, 1);
    deepEqual(body.orders, { placed: 2, canceled: 1 });
    deepEqual(body.handoffs, [{ reason: 'customer_asked', count: 1 }]);
    equal(body.ai.totalUsd, 0.0032);
    deepEqual(body.jev, { turns: 1, direct: 1 });
  });

  it('adds every store when no store is given', async () => {
    const first = await setup();
    const second = await setup();

    await aiCall(first.storeId, first.scope.conversationId, { at: '2020-04-02T15:00:00.000Z', costUsd: 0.001 });
    await aiCall(second.storeId, second.scope.conversationId, { at: '2020-04-02T15:00:00.000Z', costUsd: 0.002 });

    const { body } = await report({ from: '2020-04-02', to: '2020-04-02' });

    equal(body.conversations, 2);
    equal(body.ai.totalUsd, 0.003);
    equal(body.jev, null);
  });

  it('answers zeros for an empty period', async () => {
    const { storeId } = await setup();

    const { body } = await report({ storeId, from: '2019-01-01', to: '2019-01-31' });

    deepEqual(body, {
      period: { from: '2019-01-01', to: '2019-01-31', days: 31 },
      conversations: 0,
      orders: { placed: 0, canceled: 0 },
      handoffs: [],
      ai: { totalUsd: 0, byProvider: [], byPath: [], byModel: [], byPromptVersion: [] },
      jev: null,
      billing: { orders: 0, placed: 0, amountCents: 0, averagePercent: null },
      webOrders: {
        codesSent: 0,
        codesDelivered: 0,
        codesFailed: 0,
        failures: [],
        codesVerified: 0,
        codesWithOrder: 0,
        orders: 0,
        amountCents: 0
      }
    });
  });

  it('counts the WhatsApp codes paid for and the web orders billed', async () => {
    const { storeId, scope } = await setup();
    const at = '2020-05-05T15:00:00.000Z';
    const placed = await order(scope, { placedAt: at, status: OrderStatus.Done });

    const code = (verified: boolean, orderId: string | null) =>
      db.phone_verifications.insertOne({
        data: {
          id: randomUUID(),
          store_id: storeId,
          phone: '5511988887777',
          code_hash: 'x',
          attempts: 1,
          verified_at: verified ? at : null,
          order_id: orderId,
          expires_at: at,
          created_at: at
        }
      });

    await code(false, null);
    await code(true, null);
    await code(true, placed);

    await db.billing_records.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        conversation_id: scope.conversationId,
        order_id: placed,
        outcome: BillingOutcome.Web,
        steps: [],
        percent: 30,
        price_cents: 50,
        amount_cents: 15,
        created_at: at,
        updated_at: at
      }
    });

    const { body } = await report({ storeId, from: '2020-05-05', to: '2020-05-05' });

    deepEqual(body.webOrders, {
      codesSent: 3,
      codesDelivered: 0,
      codesFailed: 0,
      failures: [],
      codesVerified: 2,
      codesWithOrder: 1,
      orders: 1,
      amountCents: 15
    });
  });

  it('refuses a bad period and an unknown store', async () => {
    const badPeriod = (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'period';

    await rejects(report({ from: '2020-03-10', to: '2020-03-01' }), badPeriod);
    await rejects(report({ from: '2020-01-01', to: '2020-12-31' }), badPeriod);
    await rejects(report({ storeId: randomUUID(), from: FROM, to: TO }), HttpNotFoundError);
  });
});
