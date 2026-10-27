import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../../db';

import { OrderRepository } from '../../orders/repository';
import { asaasConfig } from '../asaas-client';
import { PaymentsRepository } from '../repository';

/**
 * Every day at 06:00 in Brazil: marks drafts left longer than their store's memory window as abandoned; closes the previous month on the first run after day 1, sets the cycle's card charge
 * (Asaas charges on `CHARGE_DAY`) and blocks stores past the grace days. Missed days catch up on the next run.
 */
export declare class BillingDailyCron extends Cron.Service {
  expression: 'cron(0 6 * * ? *)';

  timezone: 'America/Sao_Paulo';

  maxRetries: 2;

  target: Cron.UseTarget<{
    handler: typeof billingDailyHandler;
    timeout: 300;
  }>;

  variables: {
    ASAAS_API_URL: Environment.Variable<'ASAAS_API_URL'>;
    ASAAS_API_KEY: Environment.Variable<'ASAAS_API_KEY'>;
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

export async function billingDailyHandler(
  _request: Cron.Incoming<null>,
  { db, variables }: Service.Context<BillingDailyCron>
) {
  // First: cheap, and it must not wait for a payments failure to be retried.
  await OrderRepository.abandonStaleDrafts(db, new Date());
  await PaymentsRepository.runDaily(db, asaasConfig(variables), new Date());
}
