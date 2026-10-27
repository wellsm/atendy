import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SimulationRunRow } from '../../simulations/types';
import type { AdminProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { SIMULATION_CUSTOMER_MODELS } from '../../simulations/customer';
import { SimulationRepository } from '../../simulations/repository';

export declare class ListSimulationRunsRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class ListSimulationRunsResponse implements Http.Response {
  status: 200;
  body: {
    runs: SimulationRunRow[];
    /**
     * Models a new run may use for the customer; the first is the default.
     */
    customerModels: string[];
  };
}

/**
 * Latest simulation runs with their status counts, newest first, and the customer models a new run may pick.
 */
export async function listAdminSimulationRunsHandler(
  _request: Http.Incoming<ListSimulationRunsRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ListSimulationRunsResponse> {
  return {
    status: 200,
    body: {
      runs: await SimulationRepository.listRuns(db),
      customerModels: SIMULATION_CUSTOMER_MODELS.map(({ id }) => id)
    }
  };
}
