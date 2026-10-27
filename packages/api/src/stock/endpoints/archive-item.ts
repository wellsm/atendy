import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';

export declare class ArchiveStockItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    itemId: String.UUID;
  };
}

export declare class ArchiveStockItemResponse implements Http.Response {
  status: 200;
  body: {
    archived: true;
  };
}

export async function archiveStockItemHandler(
  request: Http.Incoming<ArchiveStockItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ArchiveStockItemResponse> {
  const store = await requireStore(db, request.identity);

  if (!(await StockRepository.archiveItem(db, store.id, request.parameters.itemId))) {
    throw new HttpNotFoundError('Stock item not found');
  }

  return { status: 200, body: { archived: true } };
}
