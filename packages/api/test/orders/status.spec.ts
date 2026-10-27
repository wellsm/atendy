import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canTransition, statusNotification } from '../../src/orders/status';
import { Fulfillment, OrderStatus } from '../../src/orders/types';

describe('order status', () => {
  it('allows only the store flow placed → accepted → out → done, with cancel before done', () => {
    const allowed = [
      [OrderStatus.Placed, OrderStatus.Accepted],
      [OrderStatus.Placed, OrderStatus.Canceled],
      [OrderStatus.Accepted, OrderStatus.Out],
      [OrderStatus.Accepted, OrderStatus.Canceled],
      [OrderStatus.Out, OrderStatus.Done],
      [OrderStatus.Out, OrderStatus.Canceled]
    ];

    const all = [
      OrderStatus.Draft,
      OrderStatus.Placed,
      OrderStatus.Accepted,
      OrderStatus.Out,
      OrderStatus.Done,
      OrderStatus.Canceled
    ];

    for (const from of all) {
      for (const to of all) {
        const expected = allowed.some(([a, b]) => a === from && b === to);

        equal(canTransition(from, to), expected, `${from} → ${to}`);
      }
    }
  });

  it('notifies accepted, out (by fulfillment) and canceled with the order code, never done', () => {
    const order = (fulfillment: Fulfillment) => ({ id: 'abcd1234', code: 'K7Q2MX', fulfillment });

    equal(
      statusNotification(OrderStatus.Accepted, order(Fulfillment.Delivery)),
      '✅ Pedido #K7Q2MX aceito! Já está sendo preparado 👨‍🍳'
    );
    equal(
      statusNotification(OrderStatus.Out, order(Fulfillment.Delivery)),
      '🛵 Seu pedido #K7Q2MX saiu para entrega!\nFica de olho, já já chega 😋'
    );
    equal(
      statusNotification(OrderStatus.Out, order(Fulfillment.Pickup)),
      '🛍️ Seu pedido #K7Q2MX está pronto para retirada!'
    );
    equal(
      statusNotification(OrderStatus.Canceled, order(Fulfillment.Pickup)),
      '❌ Seu pedido #K7Q2MX foi cancelado pela loja.\nSe tiver alguma dúvida, é só responder esta mensagem 💬'
    );
    equal(statusNotification(OrderStatus.Done, order(Fulfillment.Delivery)), undefined);
  });
});
