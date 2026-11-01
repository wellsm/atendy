import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validateStockAlert } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdateStockAlertRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    stockAlertPhone: string | null;
    stockAlertHour: number | null;
  };
}

export declare class UpdateStockAlertResponse implements Http.Response {
  status: 200;
  body: {
    stockAlertPhone: string | null;
    stockAlertHour: number | null;
  };
}

/**
 * Where and when the daily low-stock digest goes; a null phone turns it off, a null hour means 9.
 */
export async function updateStockAlertHandler(
  request: Http.Incoming<UpdateStockAlertRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateStockAlertResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);

  const { phone, hour } = await withSettingsErrors(() =>
    validateStockAlert({ phone: request.body.stockAlertPhone, hour: request.body.stockAlertHour })
  );

  await StoreRepository.setStockAlert(db, store.id, { phone, hour });

  return { status: 200, body: { stockAlertPhone: phone, stockAlertHour: hour } };
}
