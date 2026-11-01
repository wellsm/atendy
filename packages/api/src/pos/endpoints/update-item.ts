import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { Discount } from '../../orders/types';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { posDiscountGuard } from '../discount-guard';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class UpdatePosSaleItemRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePosSaleItemResponse> {
  const store = await requirePosStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.PosSell);
  const { saleId, itemId } = request.parameters;

  const sale = await withPosErrors(() =>
    PosRepository.updateLine(
      db,
      store.id,
      saleId,
      itemId,
      request.body,
      posDiscountGuard(db, store, request.identity, request.headers)
    )
  );

  return { status: 200, body: { sale } };
}
