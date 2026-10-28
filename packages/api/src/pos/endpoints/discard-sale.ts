import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { requirePosStore } from '../../panel/pos-store';
import { withPosErrors } from '../http-errors';
import { PosRepository } from '../repository';

export declare class DiscardPosSaleRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    saleId: String.UUID;
  };
}

export declare class DiscardPosSaleResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Deletes a held sale and its lines (only while it is a draft).
 */
export async function discardPosSaleHandler(
  request: Http.Incoming<DiscardPosSaleRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<DiscardPosSaleResponse> {
  const store = await requirePosStore(db, request.identity);
  const { saleId } = request.parameters;

  await withPosErrors(() => PosRepository.discard(db, store.id, saleId));

  return { status: 200, body: { id: saleId } };
}
