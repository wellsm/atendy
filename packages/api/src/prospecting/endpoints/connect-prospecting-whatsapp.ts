import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminIdentity } from '../../admin/types';
import type { ProspectingWhatsAppProvider } from '../provider';

import { withEvolutionErrors } from '../../panel/whatsapp';
import { assertProspectingEnabled } from '../enabled';
import { ProspectingWhatsApp } from '../whatsapp';

export declare class ConnectProspectingWhatsAppRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class ConnectProspectingWhatsAppResponse implements Http.Response {
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
 * Creates the sender's Evolution instance on first use and asks for a QR code.
 */
export async function connectProspectingWhatsAppHandler(
  _request: Http.Incoming<ConnectProspectingWhatsAppRequest>,
  { db }: Service.Context<ProspectingWhatsAppProvider>
): Promise<ConnectProspectingWhatsAppResponse> {
  assertProspectingEnabled();

  const qr = await withEvolutionErrors(() => ProspectingWhatsApp.connect(db, process.env));

  return { status: 200, body: qr };
}
