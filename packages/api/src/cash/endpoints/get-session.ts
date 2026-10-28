import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashSession } from '../repository';
import type { CashReportView } from '../summary';

import { requireStore } from '../../panel/store';
import { StoreRepository } from '../../stores/repository';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';
import { hideExpected } from '../summary';

export declare class GetCashSessionRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    sessionId: String.UUID;
  };
}

export declare class GetCashSessionResponse implements Http.Response {
  status: 200;
  body: {
    session: CashSession;
    report: CashReportView;
  };
}

/**
 * A session's report ("resumo do caixa"); an open one under blind close hides the expected cash.
 */
export async function getCashSessionHandler(
  request: Http.Incoming<GetCashSessionRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetCashSessionResponse> {
  const store = await requireStore(db, request.identity);
  const { sessionId } = request.parameters;

  const [session, report] = await withCashErrors(() =>
    Promise.all([CashRepository.getSession(db, store.id, sessionId), CashRepository.report(db, store.id, sessionId)])
  );

  const hidden = !session.closedAt && (await StoreRepository.getPosSettings(db, store.id)).blindClose;

  return { status: 200, body: { session, report: hidden ? hideExpected(report) : report } };
}
