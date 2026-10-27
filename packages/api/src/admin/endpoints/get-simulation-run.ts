import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SimulationResult, SimulationRun } from '../../simulations/types';
import type { AdminProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { SimulationRepository } from '../../simulations/repository';

export declare class GetSimulationRunRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    runId: String.UUID;
  };
}

export declare class GetSimulationRunResponse implements Http.Response {
  status: 200;
  body: {
    run: SimulationRun & { source: string };
    simulations: SimulationResult[];
  };
}

/**
 * One run: each simulation's checks, turns and costs (bot, customer, judge) and the billing it produced. Simulations
 * stuck without a reply are closed as errors first.
 */
export async function getAdminSimulationRunHandler(
  request: Http.Incoming<GetSimulationRunRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<GetSimulationRunResponse> {
  const detail = await SimulationRepository.getRun(db, request.parameters.runId);

  if (!detail) {
    throw new HttpNotFoundError('Simulation run not found.');
  }

  return { status: 200, body: detail };
}
