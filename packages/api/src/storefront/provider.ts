import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';
import type { PanelEventsQueue } from '../realtime/queues/panel-events';
import type { ProductImages } from '../storage';

export declare class StorefrontProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    productImages: Environment.Service<ProductImages>;
  };
}

/**
 * Phone verification: WhatsApp code from Atendy's own Cloud API number and the signed "phone verified" token.
 */
export declare class StorefrontPhoneProvider implements Http.Provider {
  variables: {
    /**
     * Atendy's Cloud API number (never a store's). `local` = no send; the code comes back in the response (local
     * dev only).
     */
    WHATSAPP_OTP_PHONE_ID: Environment.Variable<'WHATSAPP_OTP_PHONE_ID'>;
    WHATSAPP_OTP_TOKEN: Environment.Variable<'WHATSAPP_OTP_TOKEN'>;
    /**
     * Signs the "phone verified" token kept by the browser and hashes codes and IPs.
     */
    WEB_PHONE_TOKEN_SECRET: Environment.Variable<'WEB_PHONE_TOKEN_SECRET'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Web order quote and placement: customer address geocoding and the phone token check.
 */
export declare class StorefrontOrderProvider implements Http.Provider {
  variables: {
    GOOGLE_MAPS_API_KEY: Environment.Variable<'GOOGLE_MAPS_API_KEY'>;
    WEB_PHONE_TOKEN_SECRET: Environment.Variable<'WEB_PHONE_TOKEN_SECRET'>;
  };

  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}
