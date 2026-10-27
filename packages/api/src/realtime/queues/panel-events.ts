import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { RealtimeDb } from '../../realtime-db';
import type { PanelSocket } from '../../socket';
import type { PanelTrigger } from '../types';

import { ConnectionRepository } from '../repository';
import { PanelSocketMessageType } from '../types';

export type PanelEvent = {
  storeId: string;
  triggers: PanelTrigger[];
  conversationId?: string;
};

/**
 * Fans one store change out to every open panel of that store (`notifyPanel` enqueues).
 */
export declare class PanelEventsQueue extends Queue.Unordered<PanelEvent> {
  deadLetter: Queue.UseDeadLetter<{
    maxAttempts: 3;
  }>;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof panelEventsHandler;
    }>
  ];

  services: {
    realtimeDb: Environment.Service<RealtimeDb>;
    panelSocket: Environment.Service<PanelSocket>;
  };
}

export async function panelEventsHandler(
  request: Queue.Incoming<PanelEvent>,
  { realtimeDb, panelSocket }: Service.Context<PanelEventsQueue>
) {
  const { storeId, triggers, conversationId } = request.message;

  const connectionIds = await ConnectionRepository.listByStore(realtimeDb, storeId);

  // One failed post must not fail the others nor retry the event (a retry would post to every panel again). A gone
  // connection is not an error anyway: its row leaves on disconnect or by TTL.
  await Promise.allSettled(
    connectionIds.map((connectionId) =>
      panelSocket.sendMessage(connectionId, {
        type: PanelSocketMessageType.Refresh,
        triggers,
        ...(conversationId && { conversationId })
      })
    )
  );
}
