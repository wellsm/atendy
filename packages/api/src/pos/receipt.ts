import type { PosSale } from './types';

import { formatCents, PAYMENT_TEXT } from '../orders/summary';

/**
 * Plain-text receipt of a finalized counter sale, for WhatsApp.
 */
export const formatPosReceipt = (store: { name: string }, sale: PosSale) => {
  const lines = [`*${store.name}*`, ...(sale.code ? [`Pedido ${sale.code}`] : []), ''];

  for (const item of sale.items) {
    lines.push(`${item.qty}× ${item.name} — ${formatCents(item.lineTotalCents)}`);

    for (const option of item.options.split('; ').filter(Boolean)) {
      lines.push(`   • ${option}`);
    }
  }

  lines.push('');

  if (sale.discountCents) {
    lines.push(`Desconto: -${formatCents(sale.discountCents)}`);
  }

  if (sale.surchargeCents) {
    lines.push(`Acréscimo: ${formatCents(sale.surchargeCents)}`);
  }

  lines.push(`*Total: ${formatCents(sale.totalCents)}*`, '');

  for (const payment of sale.payments) {
    lines.push(`${PAYMENT_TEXT[payment.method] ?? payment.method}: ${formatCents(payment.amountCents)}`);

    if (payment.receivedCents != null) {
      lines.push(`Recebido: ${formatCents(payment.receivedCents)}`);
    }

    if (payment.changeCents) {
      lines.push(`Troco: ${formatCents(payment.changeCents)}`);
    }
  }

  lines.push('', 'Não é documento fiscal.');

  return lines.join('\n');
};
