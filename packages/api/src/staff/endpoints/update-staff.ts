import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { StaffMember } from '../types';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStaffErrors } from '../http-errors';
import { StaffRepository } from '../repository';

export declare class UpdateStaffRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    staffId: String.UUID;
  };
  body: {
    name: string;
    role: string;
    delivers: boolean;
    phone: string | null;
    pin?: string | null;
    active: boolean;
  };
}

export declare class UpdateStaffResponse implements Http.Response {
  status: 200;
  body: {
    staff: StaffMember;
  };
}

export async function updateStaffHandler(
  request: Http.Incoming<UpdateStaffRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateStaffResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);

  const staff = await withStaffErrors(() =>
    StaffRepository.update(db, store.id, request.parameters.staffId, request.body)
  );

  return { status: 200, body: { staff } };
}
