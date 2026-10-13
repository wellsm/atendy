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
 * Fixed customer message for a status the store set (no AI). `done` sends nothing.
 */
export const statusNotification = (status: OrderStatus, fulfillment: Fulfillment | null | undefined) => {
  switch (status) {
    case OrderStatus.Accepted:
      return 'Seu pedido foi aceito e já está sendo preparado!';

    case OrderStatus.Out:
      return fulfillment === Fulfillment.Pickup
        ? 'Seu pedido está pronto para retirada!'
        : 'Seu pedido saiu para entrega!';

    case OrderStatus.Canceled:
      return 'Seu pedido foi cancelado pela loja. Se tiver alguma dúvida, é só responder esta mensagem.';

    default:
      return undefined;
  }
};
