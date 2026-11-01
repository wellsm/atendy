import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../authorize';
import type { CourierSettlementView } from '../settlements';

import { requireStore } from '../../panel/store';
import { authorize } from '../authorize';
import { withStaffErrors } from '../http-errors';
import { Permission } from '../permissions';
import { CourierSettlements } from '../settlements';

export declare class SettleCourierRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    staffId: String.UUID;
  };
  body: {
    orderIds: String.UUID[];
  };
}

export declare class SettleCourierResponse implements Http.Response {
  status: 200;
  body: {
    settlement: CourierSettlementView;
  };
}

/**
 * Settles the listed delivered orders; an order already settled is a 409 `settled`. The fees leave the open drawer.
 */
export async function settleCourierHandler(
  request: Http.Incoming<SettleCourierRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<SettleCourierResponse> {
  const store = await requireStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.CourierSettle);

  const settlement = await withStaffErrors(() =>
    CourierSettlements.settle(db, store.id, request.parameters.staffId, request.body.orderIds, author)
  );

  return { status: 200, body: { settlement } };
}
