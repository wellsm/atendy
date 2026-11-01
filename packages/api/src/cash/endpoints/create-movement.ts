import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { CashMovementView } from '../repository';
import type { CashMovementKind } from '../types';

import { requirePosStore } from '../../panel/pos-store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class CreateCashMovementRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateCashMovementResponse> {
  const store = await requirePosStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.CashMove);

  const movement = await withCashErrors(() => CashRepository.move(db, store.id, { ...request.body, author }));

  return { status: 201, body: { movement } };
}
