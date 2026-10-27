import type { PanelEventsQueue } from './queues/panel-events';
import type { PanelTrigger } from './types';

/**
 * Tells the store's open panels to refetch. Call it after the write succeeded.
 *
 * Errors are swallowed on purpose: a lost event only delays the panel until its 60 s fallback poll (or the refetch on
 * reconnect), and must never fail the order, message or status change that triggered it.
 */
export const notifyPanel = async (
  panelEvents: PanelEventsQueue['client'],
  storeId: string,
  triggers: PanelTrigger[],
  conversationId?: string
) => {
  try {
    await panelEvents.sendMessage({ storeId, triggers, ...(conversationId && { conversationId }) });
  } catch {
    // Best effort, see above.
  }
};
