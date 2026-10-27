import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { adminAuthorizer } from '../admin/authorizer';
import type { bulkUpdateProspectsHandler } from './endpoints/bulk-update-prospects';
import type { connectProspectingWhatsAppHandler } from './endpoints/connect-prospecting-whatsapp';
import type { disconnectProspectingWhatsAppHandler } from './endpoints/disconnect-prospecting-whatsapp';
import type { getProspectingHandler } from './endpoints/get-prospecting';
import type { getProspectingWhatsAppHandler } from './endpoints/get-prospecting-whatsapp';
import type { getProspectsOverviewHandler } from './endpoints/get-prospects-overview';
import type { importProspectsHandler } from './endpoints/import-prospects';
import type { listProspectsHandler } from './endpoints/list-prospects';
import type { queueBestProspectsHandler } from './endpoints/queue-best-prospects';
import type { updateProspectHandler } from './endpoints/update-prospect';
import type { updateProspectingHandler } from './endpoints/update-prospecting';
import type { prospectingWebhookHandler } from './endpoints/webhook';

export type ProspectingRoutes = [
  Http.UseRoute<{
    path: 'POST /webhooks/prospecting';
    handler: typeof prospectingWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>,
  Http.UseRoute<{
    path: 'GET /admin/prospecting';
    authorizer: typeof adminAuthorizer;
    handler: typeof getProspectingHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /admin/prospecting';
    authorizer: typeof adminAuthorizer;
    handler: typeof updateProspectingHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/prospecting/whatsapp';
    authorizer: typeof adminAuthorizer;
    handler: typeof getProspectingWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/prospecting/whatsapp/connect';
    authorizer: typeof adminAuthorizer;
    handler: typeof connectProspectingWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/prospecting/whatsapp/disconnect';
    authorizer: typeof adminAuthorizer;
    handler: typeof disconnectProspectingWhatsAppHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/prospecting/imports';
    authorizer: typeof adminAuthorizer;
    handler: typeof importProspectsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/prospecting/leads';
    authorizer: typeof adminAuthorizer;
    handler: typeof listProspectsHandler;
  }>,
  Http.UseRoute<{
    path: 'PATCH /admin/prospecting/leads/{id}';
    authorizer: typeof adminAuthorizer;
    handler: typeof updateProspectHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/prospecting/leads/bulk';
    authorizer: typeof adminAuthorizer;
    handler: typeof bulkUpdateProspectsHandler;
  }>,
  Http.UseRoute<{
    path: 'POST /admin/prospecting/leads/queue-best';
    authorizer: typeof adminAuthorizer;
    handler: typeof queueBestProspectsHandler;
  }>,
  Http.UseRoute<{
    path: 'GET /admin/prospecting/leads/overview';
    authorizer: typeof adminAuthorizer;
    handler: typeof getProspectsOverviewHandler;
  }>
];
