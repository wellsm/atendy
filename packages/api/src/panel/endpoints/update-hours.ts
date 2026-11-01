import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelHourRange, PanelIdentity } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validateHours } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';
import { fromPanelHours, toPanelHours } from '../types';

export declare class UpdateHoursRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    hours: PanelHourRange[];
  };
}

export declare class UpdateHoursResponse implements Http.Response {
  status: 200;
  body: {
    hours: PanelHourRange[];
  };
}

/**
 * Replaces the whole week. No range on a weekday = closed that day.
 */
export async function updateHoursHandler(
  request: Http.Incoming<UpdateHoursRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateHoursResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const hours = await withSettingsErrors(() => validateHours(fromPanelHours(request.body.hours)));

  await StoreRepository.replaceHours(db, store.id, hours);

  return { status: 200, body: { hours: toPanelHours(hours) } };
}
