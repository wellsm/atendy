import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelPosProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PosSale } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class CancelPosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    saleId: String.UUID;
  };
  body: {
    reason: string;
  };
}

export declare class CancelPosSaleResponse implements Http.Response {
  status: 200;
  body: {
    sale: PosSale;
  };
}

/**
 * Cancels a paid sale with a reason: stock back, refunds by method into the open cash session.
 */
export async function cancelPosSaleHandler(
  request: Http.Incoming<CancelPosSaleRequest>,
  { db, panelEvents }: Service.Context<PanelPosProvider>
): Promise<CancelPosSaleResponse> {
  const store = await requirePosStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.PosCancel);

  const sale = await withPosErrors(() =>
    PosRepository.cancel(db, store.id, request.parameters.saleId, {
      reason: request.body.reason,
      author
    })
  );

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Orders]);

  return { status: 200, body: { sale } };
}
