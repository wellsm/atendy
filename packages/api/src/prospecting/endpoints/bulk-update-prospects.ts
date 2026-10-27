import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Array, String } from '@ez4/schema';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectStatus } from '../types';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository } from '../repository';

export declare class BulkUpdateProspectsRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    ids: Array.Size<String.UUID, 1, 2000>;
    status: ProspectStatus.Queued | ProspectStatus.Available | ProspectStatus.Canceled | ProspectStatus.Manual;
  };
}

export declare class BulkUpdateProspectsResponse implements Http.Response {
  status: 200;
  body: {
    updated: number;
    skipped: number;
  };
}

/**
 * Same status for many leads; those that cannot take it are skipped.
 */
export async function bulkUpdateProspectsHandler(
  request: Http.Incoming<BulkUpdateProspectsRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<BulkUpdateProspectsResponse> {
  assertProspectingEnabled();

  const { ids, status } = request.body;

  return { status: 200, body: await ProspectingRepository.bulkSetStatus(db, ids, status, new Date()) };
}
