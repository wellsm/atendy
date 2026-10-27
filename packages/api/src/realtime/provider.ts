import type { Environment } from '@ez4/common';
import type { Ws } from '@ez4/gateway';
import type { Db } from '../db';

/**
 * `panelSocketAuthorizer`: verifies the Clerk token and resolves the store of its org.
 */
export declare class PanelSocketAuthProvider implements Ws.AuthProvider {
  variables: {
    CLERK_JWT_KEY: Environment.Variable<'CLERK_JWT_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
