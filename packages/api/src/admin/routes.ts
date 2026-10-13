import type { Http } from '@ez4/gateway';
import type { adminAuthorizer } from './authorizer';
import type { listStoresHandler } from './endpoints/list-stores';
import type { updateStoreHandler } from './endpoints/update-store';

export type AdminRoutes = [
  Http.UseRoute<{
    path: 'GET /admin/stores';
    authorizer: typeof adminAuthorizer;
    handler: typeof listStoresHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /admin/stores/{storeId}';
    authorizer: typeof adminAuthorizer;
    handler: typeof updateStoreHandler;
  }>
];
