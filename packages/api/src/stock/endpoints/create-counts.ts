import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class CreateStockCountsRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateStockCountsResponse> {
  const store = await requireStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.StockManage);

  await withStockErrors(() => StockRepository.recordCounts(db, store.id, request.body.counts, author));

  return { status: 201, body: { recorded: true } };
}
