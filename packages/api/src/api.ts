import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { AdminRoutes } from './admin/routes';
import type { PanelRoutes } from './panel/routes';
import type { WhatsAppRoutes } from './whatsapp/routes';

export declare class Api extends Http.Service {
  name: 'Atendy API';

  defaults: Http.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.SnakeCase;
    };
  }>;

  routes: [...WhatsAppRoutes, ...PanelRoutes, ...AdminRoutes];

  // A type literal (no env): add the production web origin when the panel is deployed.
  cors: {
    allowOrigins: ['http://localhost:3000'];
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
    allowHeaders: ['authorization', 'content-type'];
  };

  variables: {
    EVOLUTION_API_URL: Environment.Variable<'EVOLUTION_API_URL'>;
    // Global Evolution key: instance create/connect/state/logout only, never returned to the panel.
    EVOLUTION_API_KEY: Environment.Variable<'EVOLUTION_API_KEY'>;
    WEBHOOK_BASE_URL: Environment.Variable<'WEBHOOK_BASE_URL'>;
    CLERK_JWT_KEY: Environment.Variable<'CLERK_JWT_KEY'>;
    ADMIN_USER_IDS: Environment.Variable<'ADMIN_USER_IDS'>;
    TELEGRAM_BOT_TOKEN: Environment.Variable<'TELEGRAM_BOT_TOKEN'>;
    TELEGRAM_CHAT_ID: Environment.Variable<'TELEGRAM_CHAT_ID'>;
  };
}
