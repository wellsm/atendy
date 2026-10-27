import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockItemView } from '../repository';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';
import { StockFilter } from '../types';

export declare class ListStockItemsRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    filter?: StockFilter;
  };
}

export declare class ListStockItemsResponse implements Http.Response {
  status: 200;
  body: {
    items: StockItemView[];
  };
}

export async function listStockItemsHandler(
  request: Http.Incoming<ListStockItemsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListStockItemsResponse> {
  const store = await requireStore(db, request.identity);

  const items = await StockRepository.listItems(db, store.id, request.query.filter ?? StockFilter.All);

  return { status: 200, body: { items } };
}
