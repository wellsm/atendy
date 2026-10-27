import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';

/**
 * Asaas webhook: its token (set in the Asaas webhook settings) and the admin alert for refused charges.
 */
export declare class PaymentsProvider implements Http.Provider {
  variables: {
    ASAAS_WEBHOOK_TOKEN: Environment.Variable<'ASAAS_WEBHOOK_TOKEN'>;
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
