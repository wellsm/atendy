import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StoreStockMovementView } from '../repository';
import type { StockMovementKind } from '../types';

import { requireStore } from '../../panel/store';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class ListStoreStockMovementsRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    /**
     * Absent = every kind.
     */
    kind?: StockMovementKind;
    before?: string;
  };
}

export declare class ListStoreStockMovementsResponse implements Http.Response {
  status: 200;
  body: {
    movements: StoreStockMovementView[];
    next: string | null;
  };
}

/**
 * The store's stock history across items, newest first (the stock page's "Histórico").
 */
export async function listStoreStockMovementsHandler(
  request: Http.Incoming<ListStoreStockMovementsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListStoreStockMovementsResponse> {
  const store = await requireStore(db, request.identity);
  const { kind, before } = request.query;

  const page = await withStockErrors(() => StockRepository.listStoreMovements(db, store.id, { kind, before }));

  return { status: 200, body: page };
}
