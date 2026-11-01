import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelSendProvider } from '../provider';
import type { PanelIdentity, PanelOrder } from '../types';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { displayOrderCode } from '../../orders/code';
import { OrderRepository, OrderStatusError, OrderStatusErrorCode } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { courierFeeCents, findDispatchCourier, messageCourier } from '../../staff/couriers';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { requireStore } from '../store';
import { toPanelOrder } from '../types';

export declare class AssignCourierRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    orderId: String.UUID;
  };
  body: {
    courier_id: String.UUID;
  };
}

export declare class AssignCourierResponse implements Http.Response {
  status: 200;
  body: {
    order: PanelOrder;
  };
}

/**
 * Changes the courier of an order that is out for delivery: the fee is frozen again and the new courier is messaged.
 */
export async function assignCourierHandler(
  request: Http.Incoming<AssignCourierRequest>,
  { db, panelEvents }: Service.Context<PanelSendProvider>
): Promise<AssignCourierResponse> {
  const store = await requireStore(db, request.identity);
  const { orderId } = request.parameters;
  await authorize(db, store, request.identity, request.headers, Permission.CourierDispatch);

  const current = await OrderRepository.getForPanel(db, store.id, orderId);

  if (!current) {
    throw new HttpNotFoundError('Order not found');
  }

  const dispatchTo = await findDispatchCourier(db, store.id, request.body.courier_id);

  if (!dispatchTo) {
    throw new HttpBadRequestError('Choose an active courier', { field: 'courier_id' });
  }

  try {
    await OrderRepository.assignCourier(db, {
      storeId: store.id,
      orderId,
      courierId: request.body.courier_id,
      feeCents: courierFeeCents(await StoreRepository.getStaffSettings(db, store.id), { feeCents: current.fee_cents })
    });
  } catch (error) {
    if (!(error instanceof OrderStatusError)) {
      throw error;
    }

    throw error.code === OrderStatusErrorCode.NotFound
      ? new HttpNotFoundError(error.message)
      : new HttpConflictError(error.message);
  }

  await messageCourier(db, store.id, dispatchTo, {
    code: displayOrderCode(current),
    address: current.address ?? null,
    neighborhood: current.neighborhood ?? null
  });

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Orders], current.conversation_id ?? undefined);

  const order = await OrderRepository.getForPanel(db, store.id, orderId);

  return { status: 200, body: { order: toPanelOrder(order!) } };
}
