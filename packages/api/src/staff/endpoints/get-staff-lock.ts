import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { requireStore } from '../../panel/store';
import { StoreRepository } from '../../stores/repository';
import { StaffRepository } from '../repository';
import { StaffRole } from '../types';

export declare class GetStaffLockRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetStaffLockResponse implements Http.Response {
  status: 200;
  body: {
    locked: boolean;
    idleMinutes: number;
    staff: {
      id: string;
      name: string;
      role: StaffRole;
    }[];
  };
}

/**
 * Whether the panel asks "Quem está usando?" and the names it offers (active PIN employees).
 */
export async function getStaffLockHandler(
  request: Http.Incoming<GetStaffLockRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetStaffLockResponse> {
  const store = await requireStore(db, request.identity);

  const [locked, settings, staff] = await Promise.all([
    StaffRepository.isLocked(db, store.id),
    StoreRepository.getStaffSettings(db, store.id),
    StaffRepository.list(db, store.id)
  ]);

  return {
    status: 200,
    body: {
      locked,
      idleMinutes: settings.idleMinutes,
      staff: staff
        .filter((member) => member.active && member.role !== StaffRole.Courier)
        .map(({ id, name, role }) => ({ id, name, role }))
    }
  };
}
