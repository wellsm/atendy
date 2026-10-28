import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosSale } from '../types';

import { requireStore } from '../../panel/store';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class GetPosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    saleId: String.UUID;
  };
}

export declare class GetPosSaleResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

export async function getPosSaleHandler(
  request: Http.Incoming<GetPosSaleRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetPosSaleResponse> {
  const store = await requireStore(db, request.identity);

  const sale = await withPosErrors(() => PosRepository.getSale(db, store.id, request.parameters.saleId));

  return { status: 200, body: { sale } };
}
