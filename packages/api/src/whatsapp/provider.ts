import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { InboundQueue } from '../conversations/queues/inbound';
import type { Db } from '../db';

export declare class WebhookProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    inboundQueue: Environment.Service<InboundQueue>;
  };
}
