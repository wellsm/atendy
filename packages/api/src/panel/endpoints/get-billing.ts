import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { BillingSummary } from '../../payments/types';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { PaymentsRepository } from '../../payments/repository';
import { requireStore } from '../store';

export declare class GetBillingRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetBillingResponse implements Http.Response {
  status: 200;
  body: BillingSummary;
}

/**
 * Card on file (brand, last 4), usage not invoiced yet and the last invoices.
 */
export async function getBillingHandler(
  request: Http.Incoming<GetBillingRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetBillingResponse> {
  const store = await requireStore(db, request.identity);
  const summary = await PaymentsRepository.summary(db, store.id);

  if (!summary) {
    throw new HttpNotFoundError('Store not found');
  }

  return { status: 200, body: summary };
}
