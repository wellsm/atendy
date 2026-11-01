import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelPosProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PosPaymentInput, PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class FinalizePosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    saleId: String.UUID;
  };
  body: {
    payments: PosPaymentInput[];
  };
}

export declare class FinalizePosSaleResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

/**
 * Idempotent: a sale already paid is returned as it is. A sale that needs the kitchen goes to the board; a done one to its closed list.
 */
export async function finalizePosSaleHandler(
  request: Http.Incoming<FinalizePosSaleRequest>,
  { db, panelEvents }: Service.Context<PanelPosProvider>
): Promise<FinalizePosSaleResponse> {
  const store = await requirePosStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.PosSell);

  const sale = await withPosErrors(() =>
    PosRepository.finalize(db, store.id, request.parameters.saleId, {
      payments: request.body.payments,
      author
    })
  );

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Orders]);

  return { status: 200, body: { sale } };
}
