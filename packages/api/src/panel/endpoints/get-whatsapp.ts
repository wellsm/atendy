import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelWhatsAppProvider } from '../provider';
import type { PanelIdentity } from '../types';
import type { WhatsAppState } from '../whatsapp';

import { requireStore } from '../store';
import { StoreWhatsApp, withEvolutionErrors } from '../whatsapp';

export declare class GetWhatsAppRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    state: WhatsAppState;
  };
}

export async function getWhatsAppHandler(
  request: Http.Incoming<GetWhatsAppRequest>,
  { db }: Service.Context<PanelWhatsAppProvider>
): Promise<GetWhatsAppResponse> {
  const store = await requireStore(db, request.identity);
  const state = await withEvolutionErrors(() => StoreWhatsApp.state(db, store.id, process.env));

  return { status: 200, body: { state } };
}
