import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PaymentMethod } from '../../stores/types';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { StoreRepository } from '../../stores/repository';
import { validatePaymentMethods } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdatePaymentRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    paymentMethods: PaymentMethod[];
  };
}

export declare class UpdatePaymentResponse implements Http.Response {
  status: 200;
  body: {
    paymentMethods: PaymentMethod[];
  };
}

export async function updatePaymentHandler(
  request: Http.Incoming<UpdatePaymentRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdatePaymentResponse> {
  const store = await requireStore(db, request.identity);
  const paymentMethods = await withSettingsErrors(() => validatePaymentMethods(request.body.paymentMethods));

  await StoreRepository.setPaymentMethods(db, store.id, paymentMethods);

  return { status: 200, body: { paymentMethods } };
}
