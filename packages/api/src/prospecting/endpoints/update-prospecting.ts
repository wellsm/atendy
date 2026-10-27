import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer } from '@ez4/schema';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectingSummary } from '../summary';

import { HttpBadRequestError } from '@ez4/gateway';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository } from '../repository';
import { loadProspectingSummary } from '../summary';

export declare class UpdateProspectingRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    paused?: boolean;
    maxDaily?: Integer.Range<1, 200>;
    /**
     * Brazil hours (UTC−3), end exclusive; weekdays 0 = Sunday.
     */
    window?: {
      startHour: Integer.Range<0, 23>;
      endHour: Integer.Range<1, 24>;
      weekdays: Integer.Range<0, 6>[];
    };
  };
}

export declare class UpdateProspectingResponse implements Http.Response {
  status: 200;
  body: ProspectingSummary;
}

/**
 * Pause or resume the sender, change the daily limit or the sending window.
 */
export async function updateProspectingHandler(
  request: Http.Incoming<UpdateProspectingRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<UpdateProspectingResponse> {
  assertProspectingEnabled();

  const { paused, maxDaily, window } = request.body;

  if ([paused, maxDaily, window].every((value) => value === undefined)) {
    throw new HttpBadRequestError('Nothing to update.');
  }

  if (window && (window.startHour >= window.endHour || window.weekdays.length === 0)) {
    throw new HttpBadRequestError('Invalid sending window.', { field: 'window' });
  }

  const now = new Date();

  await ProspectingRepository.updateSender(db, { paused, maxDaily, window }, now);

  return { status: 200, body: await loadProspectingSummary(db, now) };
}
