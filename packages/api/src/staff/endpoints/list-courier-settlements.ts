import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CourierSettlementView } from '../settlements';

import { requireStore } from '../../panel/store';
import { withStaffErrors } from '../http-errors';
import { CourierSettlements } from '../settlements';

export declare class ListCourierSettlementsRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    staffId: String.UUID;
  };
}

export declare class ListCourierSettlementsResponse implements Http.Response {
  status: 200;
  body: {
    settlements: CourierSettlementView[];
  };
}

/**
 * Past settlements of a courier, newest first.
 */
export async function listCourierSettlementsHandler(
  request: Http.Incoming<ListCourierSettlementsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListCourierSettlementsResponse> {
  const store = await requireStore(db, request.identity);

  const settlements = await withStaffErrors(() => CourierSettlements.list(db, store.id, request.parameters.staffId));

  return { status: 200, body: { settlements } };
}
