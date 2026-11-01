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

export declare class CreateStockEntryRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    itemId: String.UUID;
    packageId?: String.UUID;
    qty: number;
    totalCostCents?: number;
  };
}

export declare class CreateStockEntryResponse implements Http.Response {
  status: 201;
  body: {
    recorded: true;
  };
}

/**
 * Purchase entry; `qty` counts packages when `packageId` is sent. The author is the signed-in Clerk user.
 */
export async function createStockEntryHandler(
  request: Http.Incoming<CreateStockEntryRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateStockEntryResponse> {
  const store = await requireStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.StockMove);

  await withStockErrors(() => StockRepository.recordEntry(db, store.id, { ...request.body, author }));

  return { status: 201, body: { recorded: true } };
}
