import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockItemView, StockPackageView } from '../repository';
import type { StockUnit } from '../types';

import { requireStore } from '../../panel/store';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class CreateStockItemRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    name: string;
    unit: StockUnit;
    barcode: string | null;
    minQty: number | null;
    packages: {
      id?: String.UUID;
      name: string;
      factor: number;
      barcode: string | null;
    }[];
  };
}

export declare class CreateStockItemResponse implements Http.Response {
  status: 201;
  body: {
    item: StockItemView;
    packages: StockPackageView[];
  };
}

export async function createStockItemHandler(
  request: Http.Incoming<CreateStockItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<CreateStockItemResponse> {
  const store = await requireStore(db, request.identity);
  const { packages, ...input } = request.body;

  const saved = await withStockErrors(async () => {
    const item = await StockRepository.createItem(db, store.id, input, packages);
    const found = await StockRepository.getItem(db, store.id, item.id);

    return { item, packages: found?.packages ?? [] };
  });

  return { status: 201, body: saved };
}
