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

  it('notifies accepted, out (by fulfillment) and canceled, never done', () => {
    equal(
      statusNotification(OrderStatus.Accepted, Fulfillment.Delivery),
      'Seu pedido foi aceito e já está sendo preparado!'
    );
    equal(statusNotification(OrderStatus.Out, Fulfillment.Delivery), 'Seu pedido saiu para entrega!');
    equal(statusNotification(OrderStatus.Out, Fulfillment.Pickup), 'Seu pedido está pronto para retirada!');
    equal(
      statusNotification(OrderStatus.Canceled, Fulfillment.Pickup),
      'Seu pedido foi cancelado pela loja. Se tiver alguma dúvida, é só responder esta mensagem.'
    );
    equal(statusNotification(OrderStatus.Done, Fulfillment.Delivery), undefined);
  });
});
