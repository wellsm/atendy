import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { StaffRole } from '../../staff/types';
import type { AdminProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { StaffRepository } from '../../staff/repository';
import { requireAdminStore } from '../detail';

export declare class ListAdminStaffRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
}

export declare class ListAdminStaffResponse implements Http.Response {
  status: 200;
  body: {
    staff: {
      id: string;
      name: string;
      role: StaffRole;
      active: boolean;
    }[];
  };
}

/**
 * Who the admin can pick to reset a PIN (see `resetAdminStaffPinHandler`).
 */
export async function listAdminStaffHandler(
  request: Http.Incoming<ListAdminStaffRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ListAdminStaffResponse> {
  const { storeId } = request.parameters;

  await requireAdminStore(db, storeId);

  const staff = await StaffRepository.list(db, storeId);

  return { status: 200, body: { staff: staff.map(({ id, name, role, active }) => ({ id, name, role, active })) } };
}
