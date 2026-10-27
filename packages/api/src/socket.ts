import type { Environment } from '@ez4/common';
import type { Ws } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { panelSocketConnectHandler } from './realtime/actions/connect';
import type { panelSocketDisconnectHandler } from './realtime/actions/disconnect';
import type { panelSocketMessageHandler } from './realtime/actions/message';
import type { panelSocketAuthorizer } from './realtime/authorizer';
import type { PanelRefreshEvent } from './realtime/types';
import type { RealtimeDb } from './realtime-db';

/**
 * Tells open store panels what changed (spec `docs/specs/panel-realtime.md`). The browser connects with
 * `?token=<Clerk session token>&slug=<store slug>`; never log the query string.
 */
export declare class PanelSocket extends Ws.Service<PanelRefreshEvent> {
  name: 'Atendy Panel Socket';

  stage: 'panel';

  defaults: Ws.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.SnakeCase;
    };
  }>;

  connect: Ws.UseConnect<{
    handler: typeof panelSocketConnectHandler;
    authorizer: typeof panelSocketAuthorizer;
  }>;

  disconnect: Ws.UseDisconnect<{
    handler: typeof panelSocketDisconnectHandler;
  }>;

  message: Ws.UseMessage<{
    handler: typeof panelSocketMessageHandler;
  }>;

  services: {
    realtimeDb: Environment.Service<RealtimeDb>;
  };
}
