import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { requireStore } from '../../panel/store';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class CreateStockCountsRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    counts: {
      itemId: String.UUID;
      counted: number;
    }[];
  };
}

export declare class CreateStockCountsResponse implements Http.Response {
  status: 201;
  body: {
    recorded: true;
  };
}

export async function createStockCountsHandler(
  request: Http.Incoming<CreateStockCountsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<CreateStockCountsResponse> {
  const store = await requireStore(db, request.identity);

  await withStockErrors(() => StockRepository.recordCounts(db, store.id, request.body.counts, request.identity.userId));

  return { status: 201, body: { recorded: true } };
}
