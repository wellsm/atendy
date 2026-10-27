import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminBillingProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { HttpConflictError } from '@ez4/gateway';

import { asaasConfig } from '../../payments/asaas-client';
import { PaymentsRepository } from '../../payments/repository';
import { requireAdminStore } from '../detail';

export declare class ChargeBillingNowRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
}

export declare class ChargeBillingNowResponse implements Http.Response {
  status: 200;
  body: {
    ok: boolean;
  };
}

/**
 * Test: the store's pending invoice is charged today instead of on the charge day (the webhook reports the result).
 */
export async function chargeAdminBillingNowHandler(
  request: Http.Incoming<ChargeBillingNowRequest>,
  { db }: Service.Context<AdminBillingProvider>
): Promise<ChargeBillingNowResponse> {
  const { storeId } = request.parameters;

  await requireAdminStore(db, storeId);

  if (!(await PaymentsRepository.chargeNow(db, asaasConfig(), storeId, new Date()))) {
    throw new HttpConflictError('No pending invoice with a card payment.');
  }

  return { status: 200, body: { ok: true } };
}
