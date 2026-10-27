import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { InboundQueue } from '../conversations/queues/inbound';
import type { Db } from '../db';
import type { PanelEventsQueue } from '../realtime/queues/panel-events';

export declare class WebhookProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    panelEvents: Environment.Service<PanelEventsQueue>;
    inboundQueue: Environment.Service<InboundQueue>;
  };
}

/**
 * Meta's Cloud API webhook (Atendy's own number).
 */
export declare class CloudWebhookProvider implements Http.Provider {
  variables: {
    /**
     * Verify token typed in Meta's webhook settings, and the app secret that signs each call.
     */
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: Environment.Variable<'WHATSAPP_WEBHOOK_VERIFY_TOKEN'>;
    WHATSAPP_APP_SECRET: Environment.Variable<'WHATSAPP_APP_SECRET'>;
  };

  services: {
    db: Environment.Service<Db>;
  };
}
