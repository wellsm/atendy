import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Dashboard } from '../dashboard';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { localMonth } from '../../payments/cycle';
import { buildDashboard, isMonth } from '../dashboard';
import { requireStore } from '../store';

export declare class GetDashboardRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    /**
     * YYYY-MM billing month; default the current one.
     */
    month?: string;
  };
}

export declare class GetDashboardResponse implements Http.Response {
  status: 200;
  body: Dashboard;
}

/**
 * The store's month: conversations, funnel, how they ended, orders and Atendy cost per day.
 */
export async function getDashboardHandler(
  request: Http.Incoming<GetDashboardRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetDashboardResponse> {
  const store = await requireStore(db, request.identity);
  const now = new Date();
  const month = request.query.month ?? localMonth(now);

  if (!isMonth(month) || month > localMonth(now)) {
    throw new HttpBadRequestError('Invalid month', { field: 'month' });
  }

  return { status: 200, body: await buildDashboard(db, store.id, month, now) };
}
