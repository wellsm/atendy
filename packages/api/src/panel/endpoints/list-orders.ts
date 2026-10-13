import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelOrder } from '../types';

import { OrderRepository, PanelOrderScope } from '../../orders/repository';
import { requireStore } from '../store';
import { toPanelOrder } from '../types';

export declare class ListOrdersRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    scope?: PanelOrderScope;
  };
}

export declare class ListOrdersResponse implements Http.Response {
  status: 200;
  body: {
    orders: PanelOrder[];
  };
}

/**
 * Orders board: open (kitchen queue) or closed (latest finished/canceled).
 */
export async function listOrdersHandler(
  request: Http.Incoming<ListOrdersRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListOrdersResponse> {
  const store = await requireStore(db, request.identity);

  const orders = await OrderRepository.listForPanel(db, store.id, request.query.scope ?? PanelOrderScope.Open);

  return { status: 200, body: { orders: orders.map(toPanelOrder) } };
}
