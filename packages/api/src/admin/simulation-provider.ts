import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';
import type { SimulationQueue } from '../simulations/queues/step';

/**
 * Admin routes that start simulations: only they carry the simulation queue client.
 */
export declare class AdminSimulationProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    simulationQueue: Environment.Service<SimulationQueue>;
  };
}
