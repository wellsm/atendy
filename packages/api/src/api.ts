import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { AdminRoutes } from './admin/routes';
import type { CashRoutes } from './cash/routes';
import type { PanelRoutes } from './panel/routes';
import type { PaymentsRoutes } from './payments/routes';
import type { ProspectingRoutes } from './prospecting/routes';
import type { StockRoutes } from './stock/routes';
import type { StorefrontRoutes } from './storefront/routes';
import type { WhatsAppRoutes } from './whatsapp/routes';

export declare class Api extends Http.Service {
  name: 'Atendy API';

  defaults: Http.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.SnakeCase;
    };
  }>;

  routes: [
    ...WhatsAppRoutes,
    ...PaymentsRoutes,
    ...PanelRoutes,
    ...StockRoutes,
    ...CashRoutes,
    ...AdminRoutes,
    ...StorefrontRoutes,
    ...ProspectingRoutes
  ];

  // A type literal (no env): add the production web origin when the panel is deployed.
  cors: {
    allowOrigins: ['http://localhost:3000', 'https://d1wc504nfok37p.cloudfront.net'];
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
    allowHeaders: ['authorization', 'content-type'];
  };

  // No `variables` here: they would reach every route Lambda. Each one lives on the providers of the handlers that
  // read it, so changing it updates only those Lambdas.
}
