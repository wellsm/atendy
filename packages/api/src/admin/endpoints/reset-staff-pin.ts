import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { withStaffErrors } from '../../staff/http-errors';
import { StaffRepository } from '../../staff/repository';
import { requireAdminStore } from '../detail';

export declare class ResetAdminStaffPinRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
    staffId: String.UUID;
  };
  body: {
    pin: string;
  };
}

export declare class ResetAdminStaffPinResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Fallback for a store locked out by a forgotten PIN (no Clerk reverification): the Atendy admin sets a new one.
 */
export async function resetAdminStaffPinHandler(
  request: Http.Incoming<ResetAdminStaffPinRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ResetAdminStaffPinResponse> {
  const { storeId, staffId } = request.parameters;

  await requireAdminStore(db, storeId);
  await withStaffErrors(() => StaffRepository.setPin(db, storeId, staffId, request.body.pin));

  return { status: 200, body: { id: staffId } };
}
