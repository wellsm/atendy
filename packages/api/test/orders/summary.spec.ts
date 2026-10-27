import type { Cart } from '../../src/orders/repository';

import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatOrderSummary } from '../../src/orders/summary';
import { Fulfillment, OrderStatus } from '../../src/orders/types';
import { PaymentMethod } from '../../src/stores/types';

const brl = (value: string) => `R$ ${value}`;

const cart = (patch: Partial<Cart> = {}): Cart => ({
  order_id: 'o1',
  status: OrderStatus.Draft,
  items: [
    {
      item_id: 'i1',
      name: 'Pizza Grande',
      qty: 1,
      options: 'Sabor: Napolitana / Catufrango; Borda: Catupiry',
      unit_price_cents: 5490,
      line_total_cents: 5490,
      notes: 'sem cebola'
    },
    {
      item_id: 'i2',
      name: 'Coca-Cola Zero 2L',
      qty: 2,
      options: '',
      unit_price_cents: 1400,
      line_total_cents: 2800,
      notes: null
    }
  ],
  fulfillment: Fulfillment.Delivery,
  address: 'Rua Padre Benedito de Camargo, 929, AP 5',
  neighborhood: 'Penha de França',
  payment_method: PaymentMethod.Cash,
  change_for_cents: 10000,
  subtotal_cents: 8290,
  fee_cents: 690,
  total_cents: 8980,
  missing: [],
  ...patch
});

describe('formatOrderSummary', () => {
  it('lists items with options and notes, delivery, payment, estimate and the bold total', () => {
    equal(
      formatOrderSummary(cart(), { min: 40, max: 50 }),
      [
        '🧾 *Resumo do pedido*',
        '',
        '➡️ 1x Pizza Grande',
        '   • Sabor: Napolitana / Catufrango',
        '   • Borda: Catupiry',
        '   📝 sem cebola',
        `   ${brl('54,90')}`,
        '➡️ 2x Coca-Cola Zero 2L',
        `   ${brl('28,00')}`,
        '',
        `🛵 Entrega: ${brl('6,90')}`,
        '🏠 Rua Padre Benedito de Camargo, 929, AP 5 · Penha de França',
        '⏱️ Previsão: 40 a 50 min',
        `💵 Dinheiro (troco para ${brl('100,00')})`,
        '',
        `💰 *Total: ${brl('89,80')}*`
      ].join('\n')
    );
  });

  it('shows pickup, free delivery and card without an estimate', () => {
    const pickup = formatOrderSummary(cart({ fulfillment: Fulfillment.Pickup, payment_method: PaymentMethod.Card }));

    equal(pickup.includes('🛍️ Retirada na loja'), true);
    equal(pickup.includes('🏠'), false);
    equal(pickup.includes('💳 Cartão'), true);

    const free = formatOrderSummary(cart({ fee_cents: 0 }), { min: 30, max: 30 });

    equal(free.includes('🛵 Entrega grátis'), true);
    equal(free.includes('⏱️ Previsão: cerca de 30 min'), true);
  });
});
