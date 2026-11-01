import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../db';
import type { PanelEventsQueue } from '../realtime/queues/panel-events';

/**
 * The public courier page (`/public/couriers/{token}`, no authorizer: the link token is the credential and must never
 * be logged).
 */
export declare class CourierProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
  };
}
