import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosHeldSale } from '../types';

import { requireStore } from '../../panel/store';
import { PosRepository } from '../repository';
import { PosSaleList } from '../types';

export declare class ListPosSalesRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    /**
     * Default `held`.
     */
    status?: PosSaleList;
  };
}

export declare class ListPosSalesResponse implements Http.Response {
  status: 200;
  body: {
    sales: PosHeldSale[];
  };
}

export async function listPosSalesHandler(
  request: Http.Incoming<ListPosSalesRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListPosSalesResponse> {
  const store = await requireStore(db, request.identity);
  const list = request.query.status ?? PosSaleList.Held;

  return { status: 200, body: { sales: await PosRepository.listSales(db, store.id, list, store.timezone) } };
}
