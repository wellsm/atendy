import { displayOrderCode } from './code';
import { formatSummaryBody } from './summary';
import { Fulfillment, OrderStatus } from './types';

/**
 * Moves the store makes from the panel. `done` and `canceled` are final; drafts are the customer's.
 */
const TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.Placed]: [OrderStatus.Accepted, OrderStatus.Canceled],
  [OrderStatus.Accepted]: [OrderStatus.Out, OrderStatus.Canceled],
  [OrderStatus.Out]: [OrderStatus.Done, OrderStatus.Canceled]
};

export const canTransition = (from: OrderStatus, to: OrderStatus) => {
  return TRANSITIONS[from]?.includes(to) ?? false;
};

/**
 * Fixed customer message for a status the store set (no AI), naming the order. `done` sends nothing.
 */
export const statusNotification = (
  status: OrderStatus,
  order: { id: string; code?: string | null; fulfillment?: Fulfillment | null }
) => {
  const code = `#${displayOrderCode(order)}`;

  switch (status) {
    case OrderStatus.Accepted:
      return `✅ Pedido ${code} aceito! Já está sendo preparado 👨‍🍳`;

    case OrderStatus.Out:
      return order.fulfillment === Fulfillment.Pickup
        ? `🛍️ Seu pedido ${code} está pronto para retirada!`
        : `🛵 Seu pedido ${code} saiu para entrega!\nFica de olho, já já chega 😋`;

    case OrderStatus.Canceled:
      return `❌ Seu pedido ${code} foi cancelado pela loja.\nSe tiver alguma dúvida, é só responder esta mensagem 💬`;

    default:
      return undefined;
  }
};

/**
 * A web order's status message: the customer never talked to the store, so the accept repeats what was ordered.
 */
export const webStatusNotification = (
  text: string,
  status: OrderStatus,
  order: {
    items: { qty: number; product_name: string; options: string }[];
    fulfillment?: Fulfillment | null;
    address?: string | null;
    neighborhood?: string | null;
    payment_method?: string | null;
    change_for_cents?: number | null;
    total_cents: number;
  }
) => {
  if (status !== OrderStatus.Accepted) {
    return text;
  }

  const body = formatSummaryBody({
    ...order,
    items: order.items.map(({ qty, product_name, options }) => ({ qty, name: product_name, options }))
  });

  return `${text}\n\n${body}`;
};
