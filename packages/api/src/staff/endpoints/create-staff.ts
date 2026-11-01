import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { StaffMember } from '../types';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStaffErrors } from '../http-errors';
import { StaffRepository } from '../repository';

export declare class CreateStaffRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    name: string;
    role: string;
    delivers: boolean;
    phone: string | null;
    pin?: string | null;
  };
}

export declare class CreateStaffResponse implements Http.Response {
  status: 201;
  body: {
    staff: StaffMember;
  };
}

export async function createStaffHandler(
  request: Http.Incoming<CreateStaffRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateStaffResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const staff = await withStaffErrors(() => StaffRepository.create(db, store.id, request.body));

  return { status: 201, body: { staff } };
}
