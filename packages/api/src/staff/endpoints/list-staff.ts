import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StaffMember } from '../types';

import { requireStore } from '../../panel/store';
import { StaffRepository } from '../repository';

export declare class ListStaffRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class ListStaffResponse implements Http.Response {
  status: 200;
  body: {
    staff: StaffMember[];
  };
}

/**
 * Every employee of the store, inactive ones included.
 */
export async function listStaffHandler(
  request: Http.Incoming<ListStaffRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListStaffResponse> {
  const store = await requireStore(db, request.identity);

  return { status: 200, body: { staff: await StaffRepository.list(db, store.id) } };
}
