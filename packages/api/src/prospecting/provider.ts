import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';

export declare class ProspectingProvider implements Http.Provider {
  variables: {
    PROSPECTING_ENABLED: Environment.Variable<'PROSPECTING_ENABLED'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * The prospecting sender's WhatsApp instance from the admin (`ProspectingWhatsApp`).
 */
export declare class ProspectingWhatsAppProvider implements Http.Provider {
  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    EVOLUTION_API_KEY: Environment.Variable<'EVOLUTION_API_KEY'>;
    WEBHOOK_BASE_URL: Environment.Variable<'WEBHOOK_BASE_URL'>;
    PROSPECTING_ENABLED: Environment.Variable<'PROSPECTING_ENABLED'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
