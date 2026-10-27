import type { DraftCart } from '../../lib/queries';

import { formatMoney, PAYMENT_LABEL } from '../../lib/format';
import { useDraft, useSettings } from '../../lib/queries';

const ADDRESS_REQUEST = 'Qual o endereço de entrega? Rua, número, complemento e bairro.';

/**
 * Same value in both ends = "aproximado"; two values = a range.
 */
const deliveryTime = (min: number | null, max: number | null) => {
  if (min != null && max != null && min !== max) {
    return `O tempo de entrega é de ${min} a ${max} minutos.`;
  }

  const minutes = max ?? min;

  return minutes == null ? undefined : `O tempo de entrega é de aproximadamente ${minutes} minutos.`;
};

/**
 * The draft as a message for the customer to confirm.
 */
const orderSummary = (cart: DraftCart) =>
  [
    'Seu pedido:',
    ...cart.items.map(
      (item) =>
        `${item.qty}x ${item.name}${item.options ? ` (${item.options})` : ''}${item.notes ? ` — obs.: ${item.notes}` : ''} — ${formatMoney(item.line_total_cents)}`
    ),
    '',
    cart.fulfillment === 'pickup'
      ? 'Retirada na loja'
      : cart.address && `Entrega em ${[cart.address, cart.neighborhood].filter(Boolean).join(' · ')}`,
    cart.payment_method &&
      `Pagamento: ${PAYMENT_LABEL[cart.payment_method]}${cart.change_for_cents != null ? ` (troco para ${formatMoney(cart.change_for_cents)})` : ''}`,
    cart.fee_cents > 0 && `Taxa de entrega: ${formatMoney(cart.fee_cents)}`,
    `Total: ${formatMoney(cart.total_cents)}`,
    '',
    'Posso confirmar?'
  ]
    .filter((line) => line !== false && line !== null && line !== undefined)
    .join('\n');

/**
 * Ready texts that fill the composer (the attendant reviews and sends): ask for the address, the delivery time from
 * the store rules, and the draft summary to confirm.
 */
export function QuickReplies(props: { conversationId: string; human: boolean; onPick: (text: string) => void }) {
  const settings = useSettings();
  const draft = useDraft(props.conversationId, props.human);
  const policy = settings.data?.policy;
  const time = policy && deliveryTime(policy.delivery_min_minutes, policy.delivery_max_minutes);
  const cart = draft.data?.cart;

  const replies = [
    { label: 'Pedir endereço', text: ADDRESS_REQUEST },
    ...(time ? [{ label: 'Tempo de entrega', text: time }] : []),
    ...(props.human && cart?.items.length ? [{ label: 'Confirmar pedido', text: orderSummary(cart) }] : [])
  ];

  return (
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {replies.map(({ label, text }) => (
        <button
          key={label}
          type="button"
          onClick={() => props.onPick(text)}
          className="shrink-0 rounded-full border border-line-2 px-2.5 py-1 text-xs text-fg-2 hover:bg-hover"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
