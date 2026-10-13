import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';

export declare class PanelProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
  };
}
