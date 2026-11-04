import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from '../panel/authorizer';
import type { getDemoThreadHandler } from './endpoints/get-thread';
import type { sendDemoMessageHandler } from './endpoints/send-message';

export type DemoRoutes = [
  Http.UseRoute<{
    path: 'POST /panel/demo-phones/messages';
    authorizer: typeof panelAuthorizer;
    handler: typeof sendDemoMessageHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/demo-phones/thread';
    authorizer: typeof panelAuthorizer;
    handler: typeof getDemoThreadHandler;
  }>
];
