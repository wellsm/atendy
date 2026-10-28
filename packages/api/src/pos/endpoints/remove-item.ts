import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class RemovePosSaleItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    saleId: String.UUID;
    itemId: String.UUID;
  };
}

export declare class RemovePosSaleItemResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

export async function removePosSaleItemHandler(
  request: Http.Incoming<RemovePosSaleItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<RemovePosSaleItemResponse> {
  const store = await requirePosStore(db, request.identity);
  const { saleId, itemId } = request.parameters;

  const sale = await withPosErrors(() => PosRepository.removeLine(db, store.id, saleId, itemId));

  return { status: 200, body: { sale } };
}
