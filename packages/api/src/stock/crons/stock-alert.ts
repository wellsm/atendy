import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../../db';

import { runStockAlerts } from '../alerts';

/**
 * Every hour: sends each store its daily low-stock digest once the store's local alert hour has passed (see
 * `runStockAlerts`).
 */
export declare class StockAlertCron extends Cron.Service {
  expression: 'cron(0 * * * ? *)';

  timezone: 'America/Sao_Paulo';

  maxRetries: 0;

  target: Cron.UseTarget<{
    handler: typeof stockAlertHandler;
    timeout: 60;
  }>;

  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    WEB_BASE_URL: Environment.Variable<'WEB_BASE_URL'>;
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

export async function stockAlertHandler(
  _request: Cron.Incoming<null>,
  { db, variables }: Service.Context<StockAlertCron>
) {
  await runStockAlerts(
    db,
    { EVOLUTION_API_URL: variables.EVOLUTION_API_URL, WEB_BASE_URL: variables.WEB_BASE_URL },
    new Date()
  );
}
