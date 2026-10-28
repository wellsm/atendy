import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashSession } from '../repository';

import { requirePosStore } from '../../panel/pos-store';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class OpenCashSessionRequest implements Http.Request {
  identity: PanelIdentity;
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
  { db }: Service.Context<PanelProvider>
): Promise<OpenCashSessionResponse> {
  const store = await requirePosStore(db, request.identity);

  const session = await withCashErrors(() =>
    CashRepository.open(db, store.id, { floatCents: request.body.floatCents, author: request.identity.userId })
  );

  return { status: 201, body: { session } };
}
