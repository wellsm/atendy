import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockUnit } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';

type LinkView = {
  stockItemId: string;
  name: string;
  unit: StockUnit;
  qty: number;
};

export declare class GetProductStockLinksRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    productId: String.UUID;
  };
}

export declare class GetProductStockLinksResponse implements Http.Response {
  status: 200;
  body: {
    product: LinkView[];
    options: {
      optionId: string;
      links: LinkView[];
    }[];
  };
}

/**
 * The stock a product and each of its options consume per unit sold.
 */
export async function getProductStockLinksHandler(
  request: Http.Incoming<GetProductStockLinksRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetProductStockLinksResponse> {
  const store = await requireStore(db, request.identity);
  const found = await StockRepository.linksOfProduct(db, store.id, request.parameters.productId);

  if (!found) {
    throw new HttpNotFoundError('Product not found');
  }

  return { status: 200, body: found };
}
