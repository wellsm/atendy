import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockMovementView } from '../repository';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class ListStockMovementsRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    itemId: String.UUID;
  };
  query: {
    before?: string;
  };
}

export declare class ListStockMovementsResponse implements Http.Response {
  status: 200;
  body: {
    movements: StockMovementView[];
    next: string | null;
  };
}

export async function listStockMovementsHandler(
  request: Http.Incoming<ListStockMovementsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListStockMovementsResponse> {
  const store = await requireStore(db, request.identity);
  const { itemId } = request.parameters;

  if (!(await StockRepository.getItem(db, store.id, itemId))) {
    throw new HttpNotFoundError('Stock item not found');
  }

  const page = await withStockErrors(() =>
    StockRepository.listMovements(db, store.id, itemId, { before: request.query.before })
  );

  return { status: 200, body: page };
}
