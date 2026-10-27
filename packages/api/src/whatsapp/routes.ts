import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { verifyWhatsAppCloudWebhookHandler, whatsAppCloudWebhookHandler } from './endpoints/cloud-webhook';
import type { evolutionWebhookHandler } from './endpoints/evolution-webhook';

export type WhatsAppRoutes = [
  Http.UseRoute<{
    path: 'POST /webhooks/whatsapp/{storeId}';
    handler: typeof evolutionWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>,
  Http.UseRoute<{
    path: 'GET /webhooks/whatsapp-cloud';
    handler: typeof verifyWhatsAppCloudWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>,
  Http.UseRoute<{
    path: 'POST /webhooks/whatsapp-cloud';
    handler: typeof whatsAppCloudWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>
];
