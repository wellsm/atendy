import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { InboundQueue } from '../conversations/queues/inbound';
import type { Db } from '../db';
import type { PanelEventsQueue } from '../realtime/queues/panel-events';

/**
 * Demo phones: fake customers talking to the stores the login is a member of (checked on Clerk).
 */
export declare class DemoProvider implements Http.Provider {
  variables: {
    DEMO_ENABLED: Environment.Variable<'DEMO_ENABLED'>;
    CLERK_SECRET_KEY: Environment.Variable<'CLERK_SECRET_KEY'>;
  };

  services: {
    db: Environment.Service<Db>;
    inboundQueue: Environment.Service<InboundQueue>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}
