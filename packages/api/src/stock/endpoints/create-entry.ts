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
    /**
     * `qty` counts packages when `packageId` is sent; `totalCostCents` is what the line cost in all.
     */
    lines: {
      itemId: String.UUID;
      packageId?: String.UUID;
      qty: number;
      totalCostCents?: number;
    }[];
    supplier?: string;
    invoice?: string;
  };
}

export declare class CreateStockEntryResponse implements Http.Response {
  status: 201;
  body: {
    recorded: true;
  };
}

/**
 * A batch of purchase entries in one transaction (a bad line writes nothing); supplier and invoice go into the
 * movements. The author is who authorized the write (employee or Clerk user).
 */
export async function createStockEntryHandler(
  request: Http.Incoming<CreateStockEntryRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateStockEntryResponse> {
  const store = await requireStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.StockMove);

  await withStockErrors(() => StockRepository.recordEntries(db, store.id, { ...request.body, author }));

  return { status: 201, body: { recorded: true } };
}
