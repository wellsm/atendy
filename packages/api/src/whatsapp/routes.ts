import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { evolutionWebhookHandler } from './endpoints/evolution-webhook';

export type WhatsAppRoutes = [
  Http.UseRoute<{
    path: 'POST /webhooks/whatsapp/{storeId}';
    handler: typeof evolutionWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>
];
