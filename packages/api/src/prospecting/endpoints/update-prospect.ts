import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingProvider } from '../provider';
import type { ProspectingRepository } from '../repository';
import type { ProspectStatus } from '../types';

import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { assertProspectingEnabled } from '../enabled';
import { ProspectingRepository as Leads, ProspectNotFoundError, ProspectStatusError } from '../repository';

export declare class UpdateProspectRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    id: String.UUID;
  };
  body: {
    note?: String.Size<0, 2000> | null;
    status?: ProspectStatus;
  };
}

export declare class UpdateProspectResponse implements Http.Response {
  status: 200;
  body: ProspectingRepository.LeadRow;
}

/**
 * Note and manual status change of one lead.
 */
export async function updateProspectHandler(
  request: Http.Incoming<UpdateProspectRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<UpdateProspectResponse> {
  assertProspectingEnabled();

  const { note, status } = request.body;

  try {
    return { status: 200, body: await Leads.updateLead(db, request.parameters.id, { note, status }, new Date()) };
  } catch (error) {
    if (error instanceof ProspectNotFoundError) {
      throw new HttpNotFoundError(error.message);
    }

    if (error instanceof ProspectStatusError) {
      throw new HttpConflictError(error.message);
    }

    throw error;
  }
}
