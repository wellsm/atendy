import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashSession } from '../repository';
import type { CashReportView } from '../summary';

import { requireStore } from '../../panel/store';
import { StoreRepository } from '../../stores/repository';
import { CashRepository } from '../repository';
import { hideExpected } from '../summary';

export declare class GetCashCurrentRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetCashCurrentResponse implements Http.Response {
  status: 200;
  body: {
    session: CashSession | null;
    report: CashReportView | null;
  };
}

/**
 * The open session with its live report, or nulls when the drawer is closed.
 */
export async function getCashCurrentHandler(
  request: Http.Incoming<GetCashCurrentRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetCashCurrentResponse> {
  const store = await requireStore(db, request.identity);
  const session = await CashRepository.currentSession(db, store.id);

  if (!session) {
    return { status: 200, body: { session: null, report: null } };
  }

  const [report, settings] = await Promise.all([
    CashRepository.report(db, store.id, session.id),
    StoreRepository.getPosSettings(db, store.id)
  ]);

  return { status: 200, body: { session, report: settings.blindClose ? hideExpected(report) : report } };
}
