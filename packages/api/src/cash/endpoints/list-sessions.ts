import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashSession } from '../repository';

import { requireStore } from '../../panel/store';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class ListCashSessionsRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    before?: string;
  };
}

export declare class ListCashSessionsResponse implements Http.Response {
  status: 200;
  body: {
    sessions: CashSession[];
    next: string | null;
  };
}

export async function listCashSessionsHandler(
  request: Http.Incoming<ListCashSessionsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListCashSessionsResponse> {
  const store = await requireStore(db, request.identity);

  const page = await withCashErrors(() => CashRepository.listSessions(db, store.id, { before: request.query.before }));

  return { status: 200, body: page };
}
