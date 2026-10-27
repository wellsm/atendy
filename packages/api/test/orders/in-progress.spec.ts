import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addOnCategories, canStartNewOrder, isDrinkCategory } from '../../src/orders/in-progress';
import { OrderStatus } from '../../src/orders/types';
import { NewOrderAfterStatus } from '../../src/stores/types';

describe('orders in progress', () => {
  const categories = [
    { id: 'c1', name: 'Pizzas' },
    { id: 'c2', name: 'Bebidas' },
    { id: 'c3', name: 'Refrigerantes e Sucos' },
    { id: 'c4', name: 'Sobremesas' }
  ];

  it('defaults the add-on categories to the drink ones', () => {
    equal(isDrinkCategory('BEBIDAS GELADAS'), true);
    equal(isDrinkCategory('Cervejas'), true);
    equal(isDrinkCategory('Pizzas Doces'), false);

    deepEqual(
      addOnCategories(null, categories).map(({ id }) => id),
      ['c2', 'c3']
    );
  });

  it('uses the store list as given, empty = none, and drops deleted categories', () => {
    deepEqual(
      addOnCategories({ add_on_category_ids: ['c4', 'gone'] }, categories).map(({ id }) => id),
      ['c4']
    );
    deepEqual(addOnCategories({ add_on_category_ids: [] }, categories), []);
  });

  it('starts a new order once the last one reached the store status; finished ones never block', () => {
    const allowed = (status: OrderStatus, after?: NewOrderAfterStatus) =>
      canStartNewOrder(status, after ? { new_order_after_status: after } : {});

    equal(allowed(OrderStatus.Placed), false);
    // Default: one order at a time.
    equal(allowed(OrderStatus.Accepted), false);
    equal(allowed(OrderStatus.Out), false);
    equal(allowed(OrderStatus.Done), true);
    equal(allowed(OrderStatus.Accepted, NewOrderAfterStatus.Accepted), true);
    equal(allowed(OrderStatus.Accepted, NewOrderAfterStatus.Out), false);
    equal(allowed(OrderStatus.Out, NewOrderAfterStatus.Out), true);
    equal(allowed(OrderStatus.Out, NewOrderAfterStatus.Done), false);
    equal(allowed(OrderStatus.Done, NewOrderAfterStatus.Done), true);
    equal(allowed(OrderStatus.Canceled, NewOrderAfterStatus.Done), true);
  });
});
