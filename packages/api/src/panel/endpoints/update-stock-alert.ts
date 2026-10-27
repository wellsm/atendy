import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { StoreRepository } from '../../stores/repository';
import { validateStockAlert } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdateStockAlertRequest implements Http.Request {
  identity: PanelIdentity;
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
  { db }: Service.Context<PanelProvider>
): Promise<UpdateStockAlertResponse> {
  const store = await requireStore(db, request.identity);

  const { phone, hour } = await withSettingsErrors(() =>
    validateStockAlert({ phone: request.body.stockAlertPhone, hour: request.body.stockAlertHour })
  );

  await StoreRepository.setStockAlert(db, store.id, { phone, hour });

  return { status: 200, body: { stockAlertPhone: phone, stockAlertHour: hour } };
}
