import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockItemView, StockPackageView } from '../repository';
import type { StockUnit } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class UpdateStockItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    itemId: String.UUID;
  };
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

export declare class UpdateStockItemResponse implements Http.Response {
  status: 200;
  body: {
    item: StockItemView;
    packages: StockPackageView[];
  };
}

/**
 * Replaces the item's fields and packages (packages sent with an id keep it).
 */
export async function updateStockItemHandler(
  request: Http.Incoming<UpdateStockItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateStockItemResponse> {
  const store = await requireStore(db, request.identity);
  const { itemId } = request.parameters;
  const { packages, ...input } = request.body;

  const saved = await withStockErrors(async () => {
    const item = await StockRepository.updateItem(db, store.id, itemId, input, packages);
    const found = item && (await StockRepository.getItem(db, store.id, itemId));

    return found;
  });

  if (!saved) {
    throw new HttpNotFoundError('Stock item not found');
  }

  return { status: 200, body: saved };
}
