import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { CashSession } from '../repository';

import { requirePosStore } from '../../panel/pos-store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class OpenCashSessionRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    floatCents: number;
  };
}

export declare class OpenCashSessionResponse implements Http.Response {
  status: 201;
  body: {
    session: CashSession;
  };
}

export async function openCashSessionHandler(
  request: Http.Incoming<OpenCashSessionRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<OpenCashSessionResponse> {
  const store = await requirePosStore(db, request.identity);
  const { author } = await authorize(db, store, request.identity, request.headers, Permission.CashOpen);

  const session = await withCashErrors(() =>
    CashRepository.open(db, store.id, { floatCents: request.body.floatCents, author })
  );

  return { status: 201, body: { session } };
}
