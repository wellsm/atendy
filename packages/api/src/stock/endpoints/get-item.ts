import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockItemLinkView, StockItemView, StockMovementView, StockPackageView } from '../repository';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';

export declare class GetStockItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    itemId: String.UUID;
  };
}

export declare class GetStockItemResponse implements Http.Response {
  status: 200;
  body: {
    item: StockItemView;
    packages: StockPackageView[];
    links: StockItemLinkView[];
    movements: StockMovementView[];
    next: string | null;
  };
}

/**
 * The item with its packages, the products and options it is linked to and the first page of movements.
 */
export async function getStockItemHandler(
  request: Http.Incoming<GetStockItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetStockItemResponse> {
  const store = await requireStore(db, request.identity);
  const { itemId } = request.parameters;

  const found = await StockRepository.getItem(db, store.id, itemId);

  if (!found) {
    throw new HttpNotFoundError('Stock item not found');
  }

  const [links, page] = await Promise.all([
    StockRepository.linksOfItem(db, store.id, itemId),
    StockRepository.listMovements(db, store.id, itemId, {})
  ]);

  return { status: 200, body: { ...found, links, ...page } };
}
