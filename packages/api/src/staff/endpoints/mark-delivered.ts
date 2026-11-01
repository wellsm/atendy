import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { CourierProvider } from '../provider';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';

import { OrderRepository, OrderStatusError } from '../../orders/repository';
import { OrderStatus } from '../../orders/types';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { StaffRepository } from '../repository';

export declare class MarkDeliveredRequest implements Http.Request {
  parameters: {
    token: string;
    orderId: String.UUID;
  };
  body: {
    lat?: number;
    lng?: number;
  };
}

export declare class MarkDeliveredResponse implements Http.Response {
  status: 200;
}

/**
 * "Entreguei": moves the courier's own `out` order to `done`, keeping where the courier was when the browser gave a
 * position. Any other order, status or token is a 404. Never log the token.
 */
export async function markDeliveredHandler(
  request: Http.Incoming<MarkDeliveredRequest>,
  { db, panelEvents }: Service.Context<CourierProvider>
): Promise<MarkDeliveredResponse> {
  const courier = await StaffRepository.findCourierByToken(db, request.parameters.token);
  const { lat, lng } = request.body;

  if (
    (lat === undefined) !== (lng === undefined) ||
    (lat !== undefined && (Math.abs(lat) > 90 || Math.abs(lng!) > 180))
  ) {
    throw new HttpBadRequestError('Invalid position', { field: 'lat' });
  }

  if (!courier) {
    throw new HttpNotFoundError('Order not found');
  }

  let conversationId: string | null;

  try {
    ({ conversationId } = await OrderRepository.setStatus(db, {
      storeId: courier.storeId,
      orderId: request.parameters.orderId,
      status: OrderStatus.Done,
      author: courier.id,
      delivered: lat === undefined ? null : { lat, lng: lng! },
      expectedCourierId: courier.id
    }));
  } catch (error) {
    if (error instanceof OrderStatusError) {
      throw new HttpNotFoundError('Order not found');
    }

    throw error;
  }

  await notifyPanel(
    panelEvents,
    courier.storeId,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    conversationId ?? undefined
  );

  return { status: 200 };
}
