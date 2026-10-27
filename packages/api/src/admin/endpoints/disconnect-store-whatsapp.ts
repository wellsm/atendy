import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { WhatsAppState } from '../../panel/whatsapp';
import type { AdminWhatsAppProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { StoreWhatsApp, withEvolutionErrors } from '../../panel/whatsapp';
import { requireAdminStore } from '../detail';

export declare class DisconnectStoreWhatsAppRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
}

export declare class DisconnectStoreWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    state: WhatsAppState;
  };
}

export async function disconnectStoreWhatsAppHandler(
  request: Http.Incoming<DisconnectStoreWhatsAppRequest>,
  { db }: Service.Context<AdminWhatsAppProvider>
): Promise<DisconnectStoreWhatsAppResponse> {
  const { storeId } = request.parameters;

  await requireAdminStore(db, storeId);

  const state = await withEvolutionErrors(() => StoreWhatsApp.disconnect(db, storeId, process.env));

  return { status: 200, body: { state } };
}
