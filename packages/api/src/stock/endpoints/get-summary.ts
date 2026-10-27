import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';
import { StockFilter } from '../types';

export declare class GetStockSummaryRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetStockSummaryResponse implements Http.Response {
  status: 200;
  body: {
    low: number;
    soldOut: number;
  };
}

/**
 * Counts over the non-archived items, for the panel badge.
 */
export async function getStockSummaryHandler(
  request: Http.Incoming<GetStockSummaryRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetStockSummaryResponse> {
  const store = await requireStore(db, request.identity);

  const [low, soldOut] = await Promise.all([
    StockRepository.listItems(db, store.id, StockFilter.Low),
    StockRepository.listItems(db, store.id, StockFilter.SoldOut)
  ]);

  return { status: 200, body: { low: low.length, soldOut: soldOut.length } };
}
