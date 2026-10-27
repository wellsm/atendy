import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { StockItemView, StockPackageView } from '../repository';

import { HttpNotFoundError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { StockRepository } from '../repository';

export declare class FindStockBarcodeRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    code: string;
  };
}

export declare class FindStockBarcodeResponse implements Http.Response {
  status: 200;
  body: {
    item: StockItemView;
    package?: StockPackageView;
  };
}

/**
 * The item (or the package of an item) with that barcode; 404 when the store has none.
 */
export async function findStockBarcodeHandler(
  request: Http.Incoming<FindStockBarcodeRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<FindStockBarcodeResponse> {
  const store = await requireStore(db, request.identity);

  const found = await StockRepository.findByBarcode(db, store.id, request.parameters.code);

  if (!found) {
    throw new HttpNotFoundError('Barcode not found');
  }

  return { status: 200, body: found };
}
