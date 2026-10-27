import type { Http } from '@ez4/gateway';
import type { ScenarioError } from '../../simulations/scenarios';
import type { AdminIdentity } from '../types';

import { parseScenarios } from '../../simulations/scenarios';

export declare class ValidateSimulationRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    /**
     * Scenario file (YAML or JSON).
     */
    source: string;
  };
}

export declare class ValidateSimulationResponse implements Http.Response {
  status: 200;
  body: {
    scenarios: {
      id: string;
      title: string;
      scripted: boolean;
      repeat: number;
      maxTurns: number;
    }[];
    errors: ScenarioError[];
  };
}

/**
 * Parses a scenario file without running it: the list to review, or every error.
 */
export function validateAdminSimulationHandler(
  request: Http.Incoming<ValidateSimulationRequest>
): ValidateSimulationResponse {
  const { scenarios, errors } = parseScenarios(request.body.source);

  return {
    status: 200,
    body: {
      scenarios: scenarios.map(({ id, title, messages, repeat, maxTurns }) => ({
        id,
        title,
        scripted: !!messages,
        repeat,
        maxTurns
      })),
      errors
    }
  };
}
