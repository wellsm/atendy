import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../../db';

import { isProspectingEnabled } from '../enabled';
import { runSend } from '../send';

/**
 * Every minute: sends at most one first message to a queued lead, respecting the pause, window, daily cap, gap and
 * brakes (see `runSend`).
 */
export declare class ProspectingSendCron extends Cron.Service {
  expression: 'cron(* * * * ? *)';

  timezone: 'America/Sao_Paulo';

  maxRetries: 0;

  target: Cron.UseTarget<{
    handler: typeof prospectingSendHandler;
    timeout: 60;
  }>;

  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    PROSPECTING_ENABLED: Environment.Variable<'PROSPECTING_ENABLED'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

export async function prospectingSendHandler(
  _request: Cron.Incoming<null>,
  { db, variables }: Service.Context<ProspectingSendCron>
) {
  if (!isProspectingEnabled()) {
    return;
  }

  await runSend(db, variables, new Date());
}
