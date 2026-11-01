import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStaffErrors } from '../http-errors';
import { StaffRepository } from '../repository';

export declare class SetStaffPinRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    staffId: String.UUID;
  };
  body: {
    pin: string;
  };
}

export declare class SetStaffPinResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

export async function setStaffPinHandler(
  request: Http.Incoming<SetStaffPinRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<SetStaffPinResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const { staffId } = request.parameters;

  await withStaffErrors(() => StaffRepository.setPin(db, store.id, staffId, request.body.pin));

  return { status: 200, body: { id: staffId } };
}
