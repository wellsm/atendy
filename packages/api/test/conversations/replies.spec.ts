import { equal, match } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildClosedReply } from '../../src/conversations/replies';

const hours = [
  { weekday: 5, opens_at: '18:00', closes_at: '23:00' },
  { weekday: 6, opens_at: '18:00', closes_at: '01:00' }
];

describe('buildClosedReply', () => {
  it('lists the opening hours when the store is closed', () => {
    const reply = buildClosedReply({ acceptingOrders: true, hours });

    match(reply, /fechados/);
    match(reply, /Sex 18:00–23:00/);
    match(reply, /Sáb 18:00–01:00/);
  });

  it('says orders are paused when the store is open but not accepting orders', () => {
    match(buildClosedReply({ acceptingOrders: false, hours }), /não estamos aceitando pedidos/);
  });

  it('does not invent hours when none are configured', () => {
    equal(buildClosedReply({ acceptingOrders: true, hours: [] }).includes('undefined'), false);
  });
});
