import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PaymentBrands, PaymentMethod } from '../../stores/types';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { acceptedBrands } from '../../stores/payment';
import { StoreRepository } from '../../stores/repository';
import { validatePayment } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdatePaymentRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    paymentMethods: PaymentMethod[];
    /**
     * Per card/voucher method; a missing key = every brand.
     */
    paymentBrands?: PaymentBrands | null;
  };
}

export declare class UpdatePaymentResponse implements Http.Response {
  status: 200;
  body: {
    paymentMethods: PaymentMethod[];
    paymentBrands: PaymentBrands;
  };
}

export async function updatePaymentHandler(
  request: Http.Incoming<UpdatePaymentRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePaymentResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const { methods, brands } = await withSettingsErrors(() =>
    validatePayment({ methods: request.body.paymentMethods, brands: request.body.paymentBrands })
  );

  await StoreRepository.setPayment(db, store.id, { methods, brands });

  return { status: 200, body: { paymentMethods: methods, paymentBrands: acceptedBrands(methods, brands) } };
}
