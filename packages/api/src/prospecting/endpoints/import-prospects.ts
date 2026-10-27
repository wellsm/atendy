import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Object } from '@ez4/schema';
import type { AdminIdentity } from '../../admin/types';
import type { ImportRowError } from '../import';
import type { ProspectingProvider } from '../provider';

import { HttpBadRequestError } from '@ez4/gateway';

import { assertProspectingEnabled } from '../enabled';
import { parseImport, ProspectImportError } from '../import';
import { ProspectingRepository } from '../repository';

export declare class ImportProspectsRequest implements Http.Request {
  identity: AdminIdentity;
  /**
   * `{ leads: [{ name, phone, messages, ...info }] }`, validated row by row by `parseImport`.
   */
  body: Object.Any;
}

export declare class ImportProspectsResponse implements Http.Response {
  status: 200;
  body: {
    importId: string;
    total: number;
    added: number;
    skippedDuplicate: number;
    skippedInvalid: number;
    errors: ImportRowError[];
  };
}

/**
 * Queues the valid rows of an import file after the current last lead.
 */
export async function importProspectsHandler(
  request: Http.Incoming<ImportProspectsRequest>,
  { db }: Service.Context<ProspectingProvider>
): Promise<ImportProspectsResponse> {
  assertProspectingEnabled();

  try {
    const parsed = parseImport(request.body);

    return { status: 200, body: await ProspectingRepository.importLeads(db, parsed, new Date()) };
  } catch (error) {
    if (error instanceof ProspectImportError) {
      throw new HttpBadRequestError(error.message, { field: 'file' });
    }

    throw error;
  }
}
