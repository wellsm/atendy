import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashMovementView } from '../repository';
import type { CashMovementKind } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class CreateCashMovementRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    kind: CashMovementKind.Sangria | CashMovementKind.Suprimento;
    amountCents: number;
    reason: string;
  };
}

export declare class CreateCashMovementResponse implements Http.Response {
  status: 201;
  body: {
    movement: CashMovementView;
  };
}

/**
 * Sangria or suprimento in the open session; the movement comes back for the printed slip.
 */
export async function createCashMovementHandler(
  request: Http.Incoming<CreateCashMovementRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<CreateCashMovementResponse> {
  const store = await requirePosStore(db, request.identity);

  const movement = await withCashErrors(() =>
    CashRepository.move(db, store.id, { ...request.body, author: request.identity.userId })
  );

  return { status: 201, body: { movement } };
}
