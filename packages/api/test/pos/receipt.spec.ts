import type { PosSale } from '../../src/pos/types';

import { equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OrderStatus } from '../../src/orders/types';
import { formatPosReceipt } from '../../src/pos/receipt';

describe('formatPosReceipt', () => {
  const sale = {
    status: OrderStatus.Done,
    code: 'AB12',
    items: [
      { qty: 2, name: 'Coca-Cola 2L', options: '', lineTotalCents: 2400 },
      { qty: 1, name: 'Pizza', options: 'Borda: Catupiry; Sabor: Calabresa', lineTotalCents: 1000 }
    ],
    discountCents: 200,
    surchargeCents: 0,
    totalCents: 3200,
    payments: [{ method: 'cash', amountCents: 3200, receivedCents: 5000, changeCents: 1800 }]
  } as unknown as PosSale;

  it('lists lines, discount, total and cash change', () => {
    const text = formatPosReceipt({ name: 'Pizzaria' }, sale);

    ok(text.includes('2× Coca-Cola 2L — R$ 24,00'));
    ok(text.includes('   • Borda: Catupiry'));
    ok(text.includes('Desconto: -R$ 2,00'));
    ok(!text.includes('Acréscimo'));
    ok(text.includes('*Total: R$ 32,00*'));
    ok(text.includes('Troco: R$ 18,00'));
    equal(text.split('\n').at(-1), 'Não é documento fiscal.');
  });
});
