import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';

export declare class AdminProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Admin authorizer: the panel's Clerk login restricted to `ADMIN_USER_IDS` (comma-separated).
 */
export declare class AdminAuthProvider implements Http.Provider {
  variables: {
    CLERK_JWT_KEY: Environment.Variable<'CLERK_JWT_KEY'>;
    ADMIN_USER_IDS: Environment.Variable<'ADMIN_USER_IDS'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

/**
 * A store's WhatsApp instance from the admin (`StoreWhatsApp`, same as the panel's).
 */
export declare class AdminWhatsAppProvider implements Http.Provider {
  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    EVOLUTION_API_KEY: Environment.Variable<'EVOLUTION_API_KEY'>;
    WEBHOOK_BASE_URL: Environment.Variable<'WEBHOOK_BASE_URL'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}

/**
 * Billing test tools: they call Asaas and `runDaily` tells the admin about blocked stores.
 */
export declare class AdminBillingProvider implements Http.Provider {
  variables: {
    ASAAS_API_URL: Environment.Variable<'ASAAS_API_URL'>;
    ASAAS_API_KEY: Environment.Variable<'ASAAS_API_KEY'>;
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
