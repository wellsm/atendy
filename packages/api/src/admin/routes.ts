import type { Http } from '@ez4/gateway';
import type { adminAuthorizer } from './authorizer';
import type { chargeAdminBillingNowHandler } from './endpoints/charge-billing-now';
import type { connectStoreWhatsAppHandler } from './endpoints/connect-store-whatsapp';
import type { createAdminSimulationRunHandler } from './endpoints/create-simulation-run';
import type { disconnectStoreWhatsAppHandler } from './endpoints/disconnect-store-whatsapp';
import type { getAdminConversationHandler } from './endpoints/get-conversation';
import type { getCostReportHandler } from './endpoints/get-cost-report';
import type { getPromptHandler } from './endpoints/get-prompt';
import type { getAdminSimulationRunHandler } from './endpoints/get-simulation-run';
import type { getStoreHandler } from './endpoints/get-store';
import type { getStoreWhatsAppHandler } from './endpoints/get-store-whatsapp';
import type { listAdminConversationsHandler } from './endpoints/list-conversations';
import type { listAdminSimulationRunsHandler } from './endpoints/list-simulation-runs';
import type { listStoresHandler } from './endpoints/list-stores';
import type { runAdminBillingHandler } from './endpoints/run-billing';
import type { seedDemoMenuHandler } from './endpoints/seed-demo-menu';
import type { updateAdminStoreHandler } from './endpoints/update-store';
import type { validateAdminSimulationHandler } from './endpoints/validate-simulation';

export type AdminRoutes = [
  Http.UseRoute<{
    path: 'GET /admin/stores';
    authorizer: typeof adminAuthorizer;
    handler: typeof listStoresHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /admin/stores/{storeId}';
    authorizer: typeof adminAuthorizer;
    handler: typeof updateAdminStoreHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/stores/{storeId}';
    authorizer: typeof adminAuthorizer;
    handler: typeof getStoreHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/stores/{storeId}/demo-menu';
    authorizer: typeof adminAuthorizer;
    handler: typeof seedDemoMenuHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/stores/{storeId}/whatsapp';
    authorizer: typeof adminAuthorizer;
    handler: typeof getStoreWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/stores/{storeId}/whatsapp/connect';
    authorizer: typeof adminAuthorizer;
    handler: typeof connectStoreWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/stores/{storeId}/whatsapp/disconnect';
    authorizer: typeof adminAuthorizer;
    handler: typeof disconnectStoreWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/reports/cost';
    authorizer: typeof adminAuthorizer;
    handler: typeof getCostReportHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/conversations';
    authorizer: typeof adminAuthorizer;
    handler: typeof listAdminConversationsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/conversations/{conversationId}';
    authorizer: typeof adminAuthorizer;
    handler: typeof getAdminConversationHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/prompt';
    authorizer: typeof adminAuthorizer;
    handler: typeof getPromptHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/simulations/validate';
    authorizer: typeof adminAuthorizer;
    handler: typeof validateAdminSimulationHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/simulations';
    authorizer: typeof adminAuthorizer;
    handler: typeof createAdminSimulationRunHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/simulations';
    authorizer: typeof adminAuthorizer;
    handler: typeof listAdminSimulationRunsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/simulations/{runId}';
    authorizer: typeof adminAuthorizer;
    handler: typeof getAdminSimulationRunHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/billing/run';
    authorizer: typeof adminAuthorizer;
    handler: typeof runAdminBillingHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/stores/{storeId}/billing/charge-now';
    authorizer: typeof adminAuthorizer;
    handler: typeof chargeAdminBillingNowHandler;
  }>
];
