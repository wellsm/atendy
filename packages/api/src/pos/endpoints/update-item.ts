import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { Discount } from '../../orders/types';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class UpdatePosSaleItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    saleId: String.UUID;
    itemId: String.UUID;
  };
  body: {
    qty?: Integer.Range<1, 999>;
    notes?: String.Size<0, 200> | null;
    discount?: Discount | null;
  };
}

export declare class UpdatePosSaleItemResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

export async function updatePosSaleItemHandler(
  request: Http.Incoming<UpdatePosSaleItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdatePosSaleItemResponse> {
  const store = await requirePosStore(db, request.identity);
  const { saleId, itemId } = request.parameters;

  const sale = await withPosErrors(() => PosRepository.updateLine(db, store.id, saleId, itemId, request.body));

  return { status: 200, body: { sale } };
}
