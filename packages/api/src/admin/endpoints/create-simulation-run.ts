import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminSimulationProvider } from '../simulation-provider';
import type { AdminIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { PROMPT_VERSION } from '../../agent/prompt-version';
import { DEFAULT_SIMULATION_CUSTOMER_MODEL, isSimulationCustomerModel } from '../../simulations/customer';
import { SimulationRepository } from '../../simulations/repository';
import { parseScenarios } from '../../simulations/scenarios';
import { requireAdminStore } from '../detail';

export declare class CreateSimulationRunRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    storeId: String.UUID;
    name?: string;
    /**
     * Scenario file (YAML or JSON).
     */
    source: string;
    /**
     * One of `SIMULATION_CUSTOMER_MODELS`; default `DEFAULT_SIMULATION_CUSTOMER_MODEL`.
     */
    customerModel?: string;
  };
}

export declare class CreateSimulationRunResponse implements Http.Response {
  status: 201;
  body: {
    runId: string;
  };
}

/**
 * Starts every scenario × repeat at once against the store, each with its own simulated customer.
 */
export async function createAdminSimulationRunHandler(
  request: Http.Incoming<CreateSimulationRunRequest>,
  { db, simulationQueue }: Service.Context<AdminSimulationProvider>
): Promise<CreateSimulationRunResponse> {
  const { storeId, name, source, customerModel = DEFAULT_SIMULATION_CUSTOMER_MODEL } = request.body;

  if (!isSimulationCustomerModel(customerModel)) {
    throw new HttpBadRequestError('Unknown customer model.', { field: 'customerModel' });
  }

  const store = await requireAdminStore(db, storeId);
  const { scenarios, errors } = parseScenarios(source);

  if (errors.length) {
    throw new HttpBadRequestError('Invalid scenarios.', { field: 'source' });
  }

  const { runId, simulationIds } = await SimulationRepository.createRun(db, {
    store,
    name: name?.trim() || `${store.name} · ${PROMPT_VERSION}`,
    source,
    scenarios,
    promptVersion: PROMPT_VERSION,
    customerModel,
    createdBy: request.identity.userId
  });

  await Promise.all(simulationIds.map((simulationId) => simulationQueue.sendMessage({ simulationId })));

  return { status: 201, body: { runId } };
}
