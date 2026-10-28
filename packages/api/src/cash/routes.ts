import type { Http } from '@ez4/gateway';
import type { panelAuthorizer } from '../panel/authorizer';
import type { closeCashSessionHandler } from './endpoints/close-session';
import type { createCashMovementHandler } from './endpoints/create-movement';
import type { getCashCurrentHandler } from './endpoints/get-current';
import type { getCashSessionHandler } from './endpoints/get-session';
import type { listCashSessionsHandler } from './endpoints/list-sessions';
import type { openCashSessionHandler } from './endpoints/open-session';

export type CashRoutes = [
  Http.UseRoute<{
    path: 'GET /panel/cash/current';
    authorizer: typeof panelAuthorizer;
    handler: typeof getCashCurrentHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/cash/sessions';
    authorizer: typeof panelAuthorizer;
    handler: typeof openCashSessionHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/cash/sessions';
    authorizer: typeof panelAuthorizer;
    handler: typeof listCashSessionsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /panel/cash/sessions/{sessionId}';
    authorizer: typeof panelAuthorizer;
    handler: typeof getCashSessionHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/cash/sessions/{sessionId}/close';
    authorizer: typeof panelAuthorizer;
    handler: typeof closeCashSessionHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /panel/cash/movements';
    authorizer: typeof panelAuthorizer;
    handler: typeof createCashMovementHandler;
  }>
];
