import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelSendProvider } from '../provider';
import type { PanelIdentity, PanelOrder } from '../types';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../../conversations/repository';
import { displayOrderCode } from '../../orders/code';
import { OrderError, OrderErrorCode } from '../../orders/errors';
import { OrderRepository, OrderStatusError, OrderStatusErrorCode } from '../../orders/repository';
import { statusNotification, webStatusNotification } from '../../orders/status';
import { Fulfillment, OrderSource, OrderStatus } from '../../orders/types';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { courierFeeCents, findDispatchCourier, messageCourier } from '../../staff/couriers';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { sendStaffMessage } from '../send';
import { requireStore } from '../store';
import { toPanelOrder } from '../types';

export declare class UpdateOrderRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    orderId: String.UUID;
  };
  body: {
    status: OrderStatus;
    /**
     * Who takes a delivery order on `out`; absent = no courier. Delivery orders only.
     */
    courier_id?: String.UUID;
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

  if (request.body.courier_id && status !== OrderStatus.Out) {
    throw new HttpBadRequestError('A courier is chosen when the order goes out', { field: 'courier_id' });
  }

  const permission = status === OrderStatus.Canceled ? Permission.OrdersCancel : Permission.OrdersBoard;
  const { author } = await authorize(db, store, request.identity, request.headers, permission);

  const courierId = request.body.courier_id;
  let courier: { id: string | null; feeCents: number | null } | undefined;
  let dispatchTo: { phone: string; token: string } | undefined;

  if (courierId) {
    await authorize(db, store, request.identity, request.headers, Permission.CourierDispatch);

    const current = await OrderRepository.getForPanel(db, store.id, orderId);

    if (current && current.fulfillment !== Fulfillment.Delivery) {
      throw new HttpBadRequestError('Only delivery orders take a courier', { field: 'courier_id' });
    }

    dispatchTo = await findDispatchCourier(db, store.id, courierId);

    if (!dispatchTo) {
      throw new HttpBadRequestError('Choose an active courier', { field: 'courier_id' });
    }

    courier = {
      id: courierId,
      feeCents: courierFeeCents(await StoreRepository.getStaffSettings(db, store.id), {
        feeCents: current?.fee_cents ?? 0
      })
    };
  }

  let changed;

  try {
    changed = await OrderRepository.setStatus(db, { storeId: store.id, orderId, status, author, courier });
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

  if (dispatchTo && status === OrderStatus.Out && order.fulfillment === Fulfillment.Delivery) {
    await messageCourier(db, store.id, dispatchTo, {
      code: displayOrderCode(order),
      address: order.address ?? null,
      neighborhood: order.neighborhood ?? null
    });
  }

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    changed.conversationId ?? undefined
  );

  return { status: 200, body: { order: toPanelOrder(order), notified } };
}
