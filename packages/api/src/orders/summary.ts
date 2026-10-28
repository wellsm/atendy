import type { Cart } from './repository';

import { Fulfillment } from './types';

/**
 * Placeholder the model writes alone on a line; `TurnResponder` swaps it for `formatOrderSummary` of the current order.
 */
export const SUMMARY_TOKEN = '[[resumo]]';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatCents = (cents: number) => BRL.format(cents / 100);

export const PAYMENT_TEXT: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  voucher: 'Vale-refeição/alimentação'
};

type SummaryItem = {
  qty: number;
  name: string;
  /**
   * `Group: Option / Option; Group: Option`, as stored on the order line.
   */
  options: string;
  notes?: string | null;
  line_total_cents?: number;
};

type SummaryOrder = {
  items: SummaryItem[];
  fulfillment?: Fulfillment | null;
  fee_cents?: number;
  address?: string | null;
  neighborhood?: string | null;
  payment_method?: string | null;
  change_for_cents?: number | null;
  total_cents: number;
};

export type DeliveryMinutes = { min: number | null; max: number | null };

const minutesText = ({ min, max }: DeliveryMinutes) => {
  if (min != null && max != null) {
    return min === max ? `cerca de ${min} min` : `${min} a ${max} min`;
  }

  return min != null ? `cerca de ${min} min` : max != null ? `até ${max} min` : undefined;
};

const itemLines = ({ qty, name, options, notes, line_total_cents }: SummaryItem) => [
  `➡️ ${qty}x ${name}`,
  ...options
    .split('; ')
    .filter(Boolean)
    .map((option) => `   • ${option}`),
  ...(notes ? [`   📝 ${notes}`] : []),
  ...(line_total_cents != null ? [`   ${formatCents(line_total_cents)}`] : [])
];

const fulfillmentLines = (order: SummaryOrder, deliveryMinutes?: DeliveryMinutes) => {
  if (order.fulfillment === Fulfillment.Pickup) {
    return ['🛍️ Retirada na loja'];
  }

  if (order.fulfillment !== Fulfillment.Delivery) {
    return [];
  }

  const estimate = deliveryMinutes && minutesText(deliveryMinutes);
  const address = [order.address, order.neighborhood].filter(Boolean).join(' · ');

  return [
    ...(order.fee_cents != null
      ? [order.fee_cents ? `🛵 Entrega: ${formatCents(order.fee_cents)}` : '🛵 Entrega grátis']
      : ['🛵 Entrega']),
    ...(address ? [`🏠 ${address}`] : []),
    ...(estimate ? [`⏱️ Previsão: ${estimate}`] : [])
  ];
};

const paymentLines = ({ payment_method: method, change_for_cents: change }: SummaryOrder) => {
  if (!method) {
    return [];
  }

  const text = PAYMENT_TEXT[method] ?? method;

  return [
    method === 'cash' ? `💵 ${text}${change != null ? ` (troco para ${formatCents(change)})` : ''}` : `💳 ${text}`
  ];
};

/**
 * Items, delivery or pickup, payment and total as one WhatsApp message (prices only from the order).
 */
export const formatSummaryBody = (order: SummaryOrder, deliveryMinutes?: DeliveryMinutes) => {
  return [
    ...order.items.flatMap(itemLines),
    '',
    ...fulfillmentLines(order, deliveryMinutes),
    ...paymentLines(order),
    '',
    `💰 *Total: ${formatCents(order.total_cents)}*`
  ].join('\n');
};

/**
 * The summary the bot shows before the customer confirms.
 */
export const formatOrderSummary = (cart: Cart, deliveryMinutes?: DeliveryMinutes) => {
  return `🧾 *Resumo do pedido*\n\n${formatSummaryBody(cart, deliveryMinutes)}`;
};
