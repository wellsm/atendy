import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectingSummary } from '../summary';

import { assertProspectingEnabled } from '../enabled';
import { loadProspectingSummary } from '../summary';

export declare class GetProspectingRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class GetProspectingResponse implements Http.Response {
  status: 200;
  body: ProspectingSummary;
}

export async function getProspectingHandler(
  _request: Http.Incoming<GetProspectingRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<GetProspectingResponse> {
  assertProspectingEnabled();

  return { status: 200, body: await loadProspectingSummary(db, new Date()) };
}
