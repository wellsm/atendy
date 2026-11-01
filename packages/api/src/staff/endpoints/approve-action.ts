import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { Permission } from '../permissions';

import { HttpBadRequestError, HttpForbiddenError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { withStaffErrors } from '../http-errors';
import { APPROVABLE } from '../permissions';
import { StaffRepository } from '../repository';
import { signApproval } from '../tokens';
import { StaffRole } from '../types';

export declare class ApproveStaffActionRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    staffId: String.UUID;
    pin: string;
    permission: Permission;
  };
}

export declare class ApproveStaffActionResponse implements Http.Response {
  status: 200;
  body: {
    approvalToken: string;
  };
}

/**
 * "Manager PIN": a manager approves one permission for the next couple of minutes (sent as `x-approval`).
 */
export async function approveStaffActionHandler(
  request: Http.Incoming<ApproveStaffActionRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<ApproveStaffActionResponse> {
  const store = await requireStore(db, request.identity);
  const { staffId, pin, permission } = request.body;

  if (!APPROVABLE.includes(permission)) {
    throw new HttpBadRequestError('This action needs no manager approval', { field: 'permission' });
  }

  const member = await withStaffErrors(() => StaffRepository.checkPin(db, store.id, staffId, pin));

  if (member.role !== StaffRole.Manager) {
    throw new HttpForbiddenError('Only a manager can approve', { field: 'role' });
  }

  return { status: 200, body: { approvalToken: signApproval({ storeId: store.id, staffId: member.id, permission }) } };
}
