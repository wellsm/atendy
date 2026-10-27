import type { Ws } from '@ez4/gateway';
import type { PanelAckMessage, PanelAliveMessage } from '../types';

import { PanelSocketMessageType } from '../types';

declare class PanelSocketMessageRequest implements Ws.Request {
  body: PanelAliveMessage;
}

declare class PanelSocketMessageResponse implements Ws.Response {
  body: PanelAckMessage;
}

/**
 * Heartbeat only: the browser sends `alive` so API Gateway never drops the connection as idle.
 */
export function panelSocketMessageHandler(_event: Ws.Incoming<PanelSocketMessageRequest>): PanelSocketMessageResponse {
  return { body: { type: PanelSocketMessageType.Ack } };
}
