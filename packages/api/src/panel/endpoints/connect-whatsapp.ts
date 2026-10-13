import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { requireStore } from '../store';
import { StoreWhatsApp, withEvolutionErrors } from '../whatsapp';

export declare class ConnectWhatsAppRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class ConnectWhatsAppResponse implements Http.Response {
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
 * QR code to link the store number. Creates the Evolution instance on first use.
 */
export async function connectWhatsAppHandler(
  request: Http.Incoming<ConnectWhatsAppRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ConnectWhatsAppResponse> {
  const store = await requireStore(db, request.identity);
  const qr = await withEvolutionErrors(() => StoreWhatsApp.connect(db, store.id, process.env));

  return { status: 200, body: qr };
}
