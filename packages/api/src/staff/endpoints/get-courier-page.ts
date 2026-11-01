import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PaymentMethod } from '../../stores/types';
import type { CourierProvider } from '../provider';

import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';

import { displayOrderCode } from '../../orders/code';
import { OrderStatus } from '../../orders/types';
import { StaffRepository } from '../repository';

export declare class GetCourierPageRequest implements Http.Request {
  parameters: {
    token: string;
  };
}

export type CourierOpenOrder = {
  id: string;
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  neighborhood: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  changeForCents: number | null;
  feeCents: number | null;
  notes: string | null;
};

export declare class GetCourierPageResponse implements Http.Response {
  status: 200;
  body: {
    storeName: string;
    courierName: string;
    open: CourierOpenOrder[];
    /**
     * Today's finished deliveries without customer data.
     */
    deliveredToday: { code: string; deliveredAt: string; feeCents: number | null }[];
  };
}

const localDate = (date: Date, timeZone: string) => date.toLocaleDateString('en-CA', { timeZone });

/**
 * The courier's own page: only that courier's orders that are out, plus what they delivered today. Never log the
 * token. A regenerated or deactivated link is a 404.
 */
export async function getCourierPageHandler(
  request: Http.Incoming<GetCourierPageRequest>,
  { db }: Service.Context<CourierProvider>
): Promise<GetCourierPageResponse> {
  const courier = await StaffRepository.findCourierByToken(db, request.parameters.token);

  if (!courier) {
    throw new HttpNotFoundError('Link not found');
  }

  const store = await db.stores.findOne({
    select: { name: true, timezone: true },
    where: { id: courier.storeId }
  });

  if (!store) {
    throw new HttpNotFoundError('Link not found');
  }

  const now = new Date();

  const [{ records: out }, { records: done }] = await Promise.all([
    db.orders.findMany({
      select: {
        id: true,
        code: true,
        customer_id: true,
        notes: true,
        address: true,
        neighborhood: true,
        total_cents: true,
        payment_method: true,
        change_for_cents: true,
        courier_fee_cents: true,
        dispatched_at: true
      },
      where: { courier_id: courier.id, status: OrderStatus.Out },
      order: { dispatched_at: Order.Asc }
    }),
    db.orders.findMany({
      select: { id: true, code: true, delivered_at: true, courier_fee_cents: true },
      where: {
        courier_id: courier.id,
        status: OrderStatus.Done,
        delivered_at: { gte: new Date(now.getTime() - 36 * 3_600_000).toISOString() }
      }
    })
  ]);

  const { records: customers } = out.length
    ? await db.customers.findMany({
        select: { id: true, name: true, phone: true },
        where: { id: { isIn: out.flatMap(({ customer_id }) => (customer_id ? [customer_id] : [])) } }
      })
    : { records: [] };

  const today = localDate(now, store.timezone);

  return {
    status: 200,
    body: {
      storeName: store.name,
      courierName: courier.name,
      open: out.map((order) => {
        const customer = customers.find(({ id }) => id === order.customer_id);

        return {
          id: order.id,
          code: displayOrderCode(order),
          customerName: customer?.name ?? null,
          customerPhone: customer?.phone ?? null,
          address: order.address ?? null,
          neighborhood: order.neighborhood ?? null,
          totalCents: order.total_cents,
          paymentMethod: order.payment_method ?? null,
          changeForCents: order.change_for_cents ?? null,
          feeCents: order.courier_fee_cents ?? null,
          notes: order.notes ?? null
        };
      }),
      deliveredToday: done
        .filter(({ delivered_at }) => delivered_at && localDate(new Date(delivered_at), store.timezone) === today)
        .map((order) => ({
          code: displayOrderCode(order),
          deliveredAt: order.delivered_at!,
          feeCents: order.courier_fee_cents ?? null
        }))
    }
  };
}
