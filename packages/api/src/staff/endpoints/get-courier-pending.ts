import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PendingOrder } from '../settlements';

import { requireStore } from '../../panel/store';
import { withStaffErrors } from '../http-errors';
import { CourierSettlements } from '../settlements';

export declare class GetCourierPendingRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    staffId: String.UUID;
  };
  query: {
    from?: string;
    to?: string;
  };
}

export declare class GetCourierPendingResponse implements Http.Response {
  status: 200;
  body: {
    orders: PendingOrder[];
    feesCents: number;
    cashCents: number;
    netCents: number;
  };
}

/**
 * Delivered orders of a courier waiting for settlement in the period (`from`/`to`, ISO instants).
 */
export async function getCourierPendingHandler(
  request: Http.Incoming<GetCourierPendingRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetCourierPendingResponse> {
  const store = await requireStore(db, request.identity);

  const pending = await withStaffErrors(() =>
    CourierSettlements.pending(db, store.id, request.parameters.staffId, request.query)
  );

  return { status: 200, body: pending };
}
