import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class CreatePosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    saleId: String.UUID;
  };
  body: {
    label?: string | null;
  };
}

export declare class CreatePosSaleResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

/**
 * Idempotent: the browser picks the sale id, a retry returns the same draft.
 */
export async function createPosSaleHandler(
  request: Http.Incoming<CreatePosSaleRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreatePosSaleResponse> {
  const store = await requirePosStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.PosSell);

  const sale = await withPosErrors(() =>
    PosRepository.createSale(db, store.id, {
      id: request.parameters.saleId,
      label: request.body.label,
      author
    })
  );

  return { status: 200, body: { sale } };
}
