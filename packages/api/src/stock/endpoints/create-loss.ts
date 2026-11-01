import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { LossReason } from '../types';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class CreateStockLossRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    itemId: String.UUID;
    qty: number;
    reason: LossReason;
    note?: string;
  };
}

export declare class CreateStockLossResponse implements Http.Response {
  status: 201;
  body: {
    recorded: true;
  };
}

export async function createStockLossHandler(
  request: Http.Incoming<CreateStockLossRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateStockLossResponse> {
  const store = await requireStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.StockMove);

  await withStockErrors(() => StockRepository.recordLoss(db, store.id, { ...request.body, author }));

  return { status: 201, body: { recorded: true } };
}
