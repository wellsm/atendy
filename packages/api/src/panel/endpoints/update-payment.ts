import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PaymentMethod } from '../../stores/types';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validatePaymentMethods } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdatePaymentRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePaymentResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const paymentMethods = await withSettingsErrors(() => validatePaymentMethods(request.body.paymentMethods));

  await StoreRepository.setPaymentMethods(db, store.id, paymentMethods);

  return { status: 200, body: { paymentMethods } };
}
