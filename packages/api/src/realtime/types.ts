/**
 * Connection rows outlive API Gateway's 2 h connection limit by 15 min, so they never need a refresh.
 */
export const CONNECTION_TTL_SECONDS = 8100;

export const enum PanelTrigger {
  Orders = 'orders',
  Conversations = 'conversations'
}

export const enum PanelSocketMessageType {
  Refresh = 'refresh',
  Alive = 'alive',
  Ack = 'ack'
}

export type PanelSocketIdentity = {
  userId: string;
  storeId: string;
};

/**
 * Sent to the panel: what to refetch, never the data itself.
 */
export type PanelRefreshEvent = {
  type: PanelSocketMessageType.Refresh;
  triggers: PanelTrigger[];
  conversationId?: string;
};

export type PanelAliveMessage = {
  type: PanelSocketMessageType.Alive;
};

export type PanelAckMessage = {
  type: PanelSocketMessageType.Ack;
};
