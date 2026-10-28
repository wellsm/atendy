import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { CashReportView } from '../summary';

import { requirePosStore } from '../../panel/pos-store';
import { withCashErrors } from '../http-errors';
import { CashRepository } from '../repository';

export declare class CloseCashSessionRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    sessionId: String.UUID;
  };
  body: {
    countedCents: number;
  };
}

export declare class CloseCashSessionResponse implements Http.Response {
  status: 200;
  body: {
    report: CashReportView;
  };
}

/**
 * Closes with the counted cash and returns the full report (expected and difference, even under blind close).
 */
export async function closeCashSessionHandler(
  request: Http.Incoming<CloseCashSessionRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<CloseCashSessionResponse> {
  const store = await requirePosStore(db, request.identity);

  const report = await withCashErrors(() =>
    CashRepository.close(db, store.id, request.parameters.sessionId, {
      countedCents: request.body.countedCents,
      author: request.identity.userId
    })
  );

  return { status: 200, body: { report } };
}
