import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectSituation } from '../types';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository } from '../repository';

export declare class QueueBestProspectsRequest implements Http.Request {
  identity: AdminIdentity;
  /**
   * The list filters (without status); empty strings mean no filter.
   */
  body: {
    q?: string;
    city?: string;
    zone?: string;
    neighborhood?: string;
    category?: string;
    situation?: ProspectSituation;
    mobile?: boolean;
  };
}

export declare class QueueBestProspectsResponse implements Http.Response {
  status: 200;
  body: {
    queued: number;
  };
}

/**
 * Queues the best available leads of the filter.
 */
export async function queueBestProspectsHandler(
  request: Http.Incoming<QueueBestProspectsRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<QueueBestProspectsResponse> {
  assertProspectingEnabled();

  const { q, city, zone, neighborhood, category, situation, mobile } = request.body;

  const filters = {
    q: q || undefined,
    city: city || undefined,
    zone: zone || undefined,
    neighborhood: neighborhood || undefined,
    category: category || undefined,
    situation: situation || undefined,
    mobile
  };

  return { status: 200, body: await ProspectingRepository.queueBest(db, filters, new Date()) };
}
