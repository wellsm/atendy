import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { WhatsAppState } from '../../panel/whatsapp';
import type { ProspectingWhatsAppProvider } from '../provider';

import { withEvolutionErrors } from '../../panel/whatsapp';
import { assertProspectingEnabled } from '../enabled';
import { ProspectingWhatsApp } from '../whatsapp';

export declare class DisconnectProspectingWhatsAppRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class DisconnectProspectingWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    state: WhatsAppState;
  };
}

export async function disconnectProspectingWhatsAppHandler(
  _request: Http.Incoming<DisconnectProspectingWhatsAppRequest>,
  { db }: Service.Context<ProspectingWhatsAppProvider>
): Promise<DisconnectProspectingWhatsAppResponse> {
  assertProspectingEnabled();

  const state = await withEvolutionErrors(() => ProspectingWhatsApp.disconnect(db, process.env));

  return { status: 200, body: { state } };
}
