import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { CourierFeeMode, StaffSettings } from '../../stores/types';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validateStaffSettings } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdateStaffSettingsRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    idleMinutes: number;
    discountLimitPercent: number;
    courierFeeMode: CourierFeeMode;
    courierFeeCents: number;
  };
}

export declare class UpdateStaffSettingsResponse implements Http.Response {
  status: 200;
  body: StaffSettings;
}

/**
 * Employee defaults: minutes idle before the panel locks and the discount limit of non-managers.
 */
export async function updateStaffSettingsHandler(
  request: Http.Incoming<UpdateStaffSettingsRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateStaffSettingsResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const settings = await withSettingsErrors(() => validateStaffSettings(request.body));

  await StoreRepository.setStaffSettings(db, store.id, settings);

  return { status: 200, body: settings };
}
