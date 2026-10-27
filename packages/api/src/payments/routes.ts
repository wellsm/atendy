import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { asaasWebhookHandler } from './endpoints/asaas-webhook';

export type PaymentsRoutes = [
  Http.UseRoute<{
    path: 'POST /webhooks/asaas';
    handler: typeof asaasWebhookHandler;
    preferences: {
      namingStyle: NamingStyle.Preserve;
    };
  }>
];
