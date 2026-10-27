import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OrderSource, OrderStatus } from '../../orders/types';
import type { StorefrontPhoneProvider } from '../provider';

import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';

import { OrderRepository } from '../../orders/repository';
import { StoreRepository } from '../../stores/repository';
import { isPhoneVerified } from '../phone-code';
import { normalizePhone, phoneVariants } from '../web-order';

/**
 * Orders shown in "Meus pedidos".
 */
const HISTORY_LIMIT = 20;

export declare class ListMyOrdersRequest implements Http.Request {
  parameters: {
    slug: string;
  };
  /**
   * POST so the token never goes in a URL.
   */
  body: {
    phone: String.Size<8, 20>;
    phoneToken: string;
  };
}

export type MyOrderItem = {
  productId: string;
  name: string;
  qty: number;
  options: string;
  selections: { groupId: string; optionIds: string[] }[];
  notes: string | null;
};

export type MyOrder = {
  code: string;
  status: OrderStatus;
  source: OrderSource | null;
  placedAt: string;
  totalCents: number;
  items: MyOrderItem[];
};

export declare class ListMyOrdersResponse implements Http.Response {
  status: 200;
  body: {
    orders: MyOrder[];
  };
}

/**
 * The customer's orders in this store (WhatsApp and site), for a phone this browser confirmed with the WhatsApp code.
 * Works while the store is closed too (the customer only looks).
 */
export async function listMyOrdersHandler(
  request: Http.Incoming<ListMyOrdersRequest>,
  { db }: Service.Context<StorefrontPhoneProvider>
): Promise<ListMyOrdersResponse> {
  const { phone, phoneToken } = request.body;
  const store = await StoreRepository.findBySlug(db, request.parameters.slug);

  if (!store?.active) {
    throw new HttpNotFoundError('Store not found');
  }

  const normalized = normalizePhone(phone);

  if (!normalized || !isPhoneVerified(phone, phoneToken)) {
    throw new HttpForbiddenError('Confirm the phone with the WhatsApp code', { field: 'phone_unverified' });
  }

  const { records: customers } = await db.customers.findMany({
    select: { id: true },
    where: { store_id: store.id, phone: { isIn: phoneVariants(normalized) } }
  });

  const orders = await OrderRepository.listForCustomer(
    db,
    store.id,
    customers.map(({ id }) => id),
    HISTORY_LIMIT
  );

  return { status: 200, body: { orders } };
}
