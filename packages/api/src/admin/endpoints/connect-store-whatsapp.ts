import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminWhatsAppProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { StoreWhatsApp, withEvolutionErrors } from '../../panel/whatsapp';
import { requireAdminStore } from '../detail';

export declare class ConnectStoreWhatsAppRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
}

export declare class ConnectStoreWhatsAppResponse implements Http.Response {
  status: 200;
  body: {
    /**
     * `data:image/png;base64,…` QR code; expires in about 40 s.
     */
    qrBase64: string | null;
    pairingCode: string | null;
  };
}

/**
 * Same as the store's own "Conectar": creates the Evolution instance on first use.
 */
export async function connectStoreWhatsAppHandler(
  request: Http.Incoming<ConnectStoreWhatsAppRequest>,
  { db }: Service.Context<AdminWhatsAppProvider>
): Promise<ConnectStoreWhatsAppResponse> {
  const { storeId } = request.parameters;

  await requireAdminStore(db, storeId);

  const qr = await withEvolutionErrors(() => StoreWhatsApp.connect(db, storeId, process.env));

  return { status: 200, body: qr };
}
