import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { WhatsAppState } from '../../panel/whatsapp';
import type { ProspectingWhatsAppProvider } from '../provider';

import { withEvolutionErrors } from '../../panel/whatsapp';
import { assertProspectingEnabled } from '../enabled';
import { ProspectingWhatsApp } from '../whatsapp';

export declare class GetProspectingWhatsAppRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class GetProspectingWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    state: WhatsAppState;
  };
}

export async function getProspectingWhatsAppHandler(
  _request: Http.Incoming<GetProspectingWhatsAppRequest>,
  { db }: Service.Context<ProspectingWhatsAppProvider>
): Promise<GetProspectingWhatsAppResponse> {
  assertProspectingEnabled();

  const state = await withEvolutionErrors(() => ProspectingWhatsApp.state(db, process.env));

  return { status: 200, body: { state } };
}
