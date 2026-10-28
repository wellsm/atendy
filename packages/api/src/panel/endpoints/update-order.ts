import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OrderStatus } from '../../orders/types';
import type { PanelSendProvider } from '../provider';
import type { PanelIdentity, PanelOrder } from '../types';

import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../../conversations/repository';
import { OrderError, OrderErrorCode } from '../../orders/errors';
import { OrderRepository, OrderStatusError, OrderStatusErrorCode } from '../../orders/repository';
import { statusNotification, webStatusNotification } from '../../orders/status';
import { OrderSource } from '../../orders/types';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { sendStaffMessage } from '../send';
import { requireStore } from '../store';
import { toPanelOrder } from '../types';

export declare class UpdateOrderRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    orderId: String.UUID;
  };
  body: {
    status: OrderStatus;
  };
}

export declare class UpdateOrderResponse implements Http.Response {
  status: 200;
  body: {
    order: PanelOrder;
    /**
     * Whether the customer got the status message (`done` sends none).
     */
    notified: boolean;
  };
}

/**
 * Store moves the order (accept, out, done, cancel), then tells the customer. The status never depends on WhatsApp.
 */
export async function updateOrderHandler(
  request: Http.Incoming<UpdateOrderRequest>,
  { db, panelEvents }: Service.Context<PanelSendProvider>
): Promise<UpdateOrderResponse> {
  const store = await requireStore(db, request.identity);
  const { orderId } = request.parameters;
  const { status } = request.body;

  let changed;

  try {
    changed = await OrderRepository.setStatus(db, { storeId: store.id, orderId, status });
  } catch (error) {
    if (error instanceof OrderError && error.code === OrderErrorCode.PosCancel) {
      throw new HttpConflictError(error.message);
    }

    if (!(error instanceof OrderStatusError)) {
      throw error;
    }

    if (error.code === OrderStatusErrorCode.NotFound) {
      throw new HttpNotFoundError(error.message);
    }

    throw new HttpConflictError(error.message);
  }

  const order = await OrderRepository.getForPanel(db, store.id, orderId);

  if (!order) {
    throw new HttpNotFoundError('Order not found');
  }

  const base = statusNotification(status, { ...order, fulfillment: changed.fulfillment });
  // Web orders repeat what was ordered on the accept: the customer never talked to the store.
  const text = base && order.source === OrderSource.Web ? webStatusNotification(base, status, order) : base;

  let notified = false;

  // POS sales have no conversation: nobody to tell.
  if (text && changed.conversationId) {
    const conversation = await ConversationRepository.findForStore(db, store.id, changed.conversationId);

    try {
      if (conversation) {
        await sendStaffMessage(db, {
          storeId: store.id,
          conversationId: conversation.id,
          to: conversation.customer.jid,
          text
        });

        notified = true;
      }
    } catch {
      // Best effort: the panel shows that the customer was not told.
    }
  }

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    changed.conversationId ?? undefined
  );

  return { status: 200, body: { order: toPanelOrder(order), notified } };
}
