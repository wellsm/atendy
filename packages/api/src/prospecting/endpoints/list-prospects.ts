import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer } from '@ez4/schema';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectingRepository } from '../repository';
import type { ProspectSituation, ProspectStatus } from '../types';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository as Leads } from '../repository';

const PAGE_SIZE = 100;

export declare class ListProspectsRequest implements Http.Request {
  identity: AdminIdentity;
  query: {
    status?: ProspectStatus;
    /**
     * Name contains it, or the phone starts with it.
     */
    q?: string;
    /**
     * `nextCursor` of the previous page.
     */
    cursor?: Integer.Range<0, 2147483647>;
    /**
     * Empty strings mean no filter.
     */
    city?: string;
    zone?: string;
    neighborhood?: string;
    category?: string;
    situation?: ProspectSituation;
    mobile?: boolean;
    sort?: 'score' | 'reviews' | 'name';
  };
}

export declare class ListProspectsResponse implements Http.Response {
  status: 200;
  body: {
    leads: ProspectingRepository.LeadRow[];
    nextCursor: number | null;
    /**
     * Leads matching the filters, whatever the page.
     */
    total: number;
  };
}

/**
 * Leads filtered and sorted (best score first by default), 100 per page.
 */
export async function listProspectsHandler(
  request: Http.Incoming<ListProspectsRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<ListProspectsResponse> {
  assertProspectingEnabled();

  const { status, q, cursor, city, zone, neighborhood, category, situation, mobile, sort } = request.query;

  const filters = {
    status: status || undefined,
    q: q || undefined,
    city: city || undefined,
    zone: zone || undefined,
    neighborhood: neighborhood || undefined,
    category: category || undefined,
    situation: situation || undefined,
    mobile,
    sort: sort || undefined
  };

  return { status: 200, body: await Leads.listLeads(db, { ...filters, cursor, limit: PAGE_SIZE }, new Date()) };
}
