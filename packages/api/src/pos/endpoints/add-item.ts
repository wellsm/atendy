import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { Discount } from '../../orders/types';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosSale } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requirePosStore } from '../../panel/pos-store';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class AddPosSaleItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    saleId: String.UUID;
  };
  body: {
    productId: String.UUID;
    qty: Integer.Range<1, 999>;
    selections: { groupId: String.UUID; optionIds: String.UUID[] }[];
    notes?: String.Size<0, 200> | null;
    discount?: Discount | null;
  };
}

export declare class AddPosSaleItemResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

/**
 * Priced from the menu on the server like an attendant's line (no store limits, sold-out allowed).
 */
export async function addPosSaleItemHandler(
  request: Http.Incoming<AddPosSaleItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<AddPosSaleItemResponse> {
  const store = await requirePosStore(db, request.identity);
  const { productId, qty, selections, notes, discount } = request.body;

  const product = (await MenuRepository.load(db, store.id)).find(({ id }) => id === productId);

  if (!product) {
    throw new HttpBadRequestError('Product not found or paused', { field: 'unknown_product' });
  }

  const sale = await withPosErrors(() =>
    PosRepository.addLine(db, store.id, request.parameters.saleId, {
      product,
      qty,
      selections: selections.map(({ groupId, optionIds }) => ({ group_id: groupId, option_ids: optionIds })),
      notes: notes?.trim() || null,
      discount
    })
  );

  return { status: 200, body: { sale } };
}
