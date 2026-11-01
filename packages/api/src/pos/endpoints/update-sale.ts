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

export declare class UpdatePosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    saleId: String.UUID;
  };
  body: {
    label?: string | null;
    notes?: String.Size<0, 300> | null;
    discount?: Discount | null;
    surchargeCents?: Integer.Range<0, 2147483647> | null;
    customer?: { name?: string | null; phone?: string | null } | null;
  };
}

export declare class UpdatePosSaleResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

export async function updatePosSaleHandler(
  request: Http.Incoming<UpdatePosSaleRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePosSaleResponse> {
  const store = await requirePosStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.PosSell);

  const sale = await withPosErrors(() =>
    PosRepository.updateSale(
      db,
      store.id,
      request.parameters.saleId,
      request.body,
      posDiscountGuard(db, store, request.identity, request.headers)
    )
  );

  return { status: 200, body: { sale } };
}
