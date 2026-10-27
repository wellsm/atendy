import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminBillingProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { asaasConfig } from '../../payments/asaas-client';
import { PaymentsRepository } from '../../payments/repository';

export declare class RunBillingRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    /**
     * Runs as if it were this instant (test a close before day 1). Default: now.
     */
    now?: String.DateTime;
    /**
     * Only this store. Default: all stores.
     */
    storeId?: String.UUID;
  };
}

export declare class RunBillingResponse implements Http.Response {
  status: 200;
  body: {
    ok: boolean;
  };
}

/**
 * Runs the daily billing job now (same idempotent work as `BillingDailyCron`).
 */
export async function runAdminBillingHandler(
  request: Http.Incoming<RunBillingRequest>,
  { db }: Service.Context<AdminBillingProvider>
): Promise<RunBillingResponse> {
  const { now, storeId } = request.body;

  await PaymentsRepository.runDaily(
    db,
    asaasConfig(),
    now ? new Date(now) : new Date(),
    storeId ? [storeId] : undefined
  );

  return { status: 200, body: { ok: true } };
}
