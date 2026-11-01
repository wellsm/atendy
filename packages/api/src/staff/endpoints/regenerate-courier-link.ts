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

export declare class RegenerateCourierLinkRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    staffId: String.UUID;
  };
}

export declare class RegenerateCourierLinkResponse implements Http.Response {
  status: 200;
  body: {
    token: string;
  };
}

/**
 * Issues a new courier link token and revokes the previous one. It is only ever returned here.
 */
export async function regenerateCourierLinkHandler(
  request: Http.Incoming<RegenerateCourierLinkRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<RegenerateCourierLinkResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);

  const token = await withStaffErrors(() =>
    StaffRepository.regenerateCourierToken(db, store.id, request.parameters.staffId)
  );

  return { status: 200, body: { token } };
}
