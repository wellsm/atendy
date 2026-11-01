import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelWhatsAppProvider } from '../provider';
import type { PanelIdentity } from '../types';
import type { WhatsAppState } from '../whatsapp';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';
import { StoreWhatsApp, withEvolutionErrors } from '../whatsapp';

export declare class DisconnectWhatsAppRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
}

export declare class DisconnectWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    state: WhatsAppState;
  };
}

export async function disconnectWhatsAppHandler(
  request: Http.Incoming<DisconnectWhatsAppRequest>,
  { db }: Service.Context<PanelWhatsAppProvider>
): Promise<DisconnectWhatsAppResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const state = await withEvolutionErrors(() => StoreWhatsApp.disconnect(db, store.id, process.env));

  return { status: 200, body: { state } };
}
