import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectingRepository as Repository } from '../repository';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository } from '../repository';

export declare class GetProspectsOverviewRequest implements Http.Request {
  identity: AdminIdentity;
  query: {
    /**
     * Empty strings mean the whole base.
     */
    city?: string;
    zone?: string;
    neighborhood?: string;
  };
}

export declare class GetProspectsOverviewResponse implements Http.Response {
  status: 200;
  body: Repository.Overview;
}

/**
 * Counts by situation and status inside a place, plus the places and categories for the filter selects.
 */
export async function getProspectsOverviewHandler(
  request: Http.Incoming<GetProspectsOverviewRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<GetProspectsOverviewResponse> {
  assertProspectingEnabled();

  const { city, zone, neighborhood } = request.query;

  const place = { city: city || undefined, zone: zone || undefined, neighborhood: neighborhood || undefined };

  return { status: 200, body: await ProspectingRepository.overview(db, place) };
}
