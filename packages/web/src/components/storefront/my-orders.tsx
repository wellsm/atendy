import type { Cart, PastItem } from '../../lib/cart';
import type { StorefrontProduct } from '../../lib/storefront';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Shell } from './checkout';
import { ApiError, postPublic } from '../../lib/api';
import { repeatLines } from '../../lib/cart';
import { formatMoney, formatPhone } from '../../lib/format';
import { savePhoneToken } from '../../lib/phone-token';

type MyOrder = {
  code: string;
  status: 'placed' | 'accepted' | 'out' | 'done' | 'canceled';
  source: 'web' | 'pos' | null;
  placed_at: string;
  total_cents: number;
  items: (PastItem & { options: string })[];
};

const STATUS_TEXT: Record<MyOrder['status'], string> = {
  placed: 'Aguardando a loja',
  accepted: 'Em preparo',
  out: 'Saiu / pronto',
  done: 'Concluído',
  canceled: 'Cancelado'
};

const WHEN = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * The customer's orders in this store (WhatsApp and site) for the phone this browser confirmed. "Pedir de novo" puts
 * the items still on the menu in the cart, at today's prices, and names the ones left out.
 */
export function MyOrders(props: {
  slug: string;
  phone: string;
  token: string;
  open: boolean;
  products: StorefrontProduct[];
  cart: Cart;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<{ code: string; missing: string[] }>();

  const history = useQuery({
    queryKey: ['my-orders', props.slug, props.phone],
    queryFn: () =>
      postPublic<{ orders: MyOrder[] }>(`/public/stores/${encodeURIComponent(props.slug)}/my-orders`, {
        phone: props.phone,
        phone_token: props.token
      }),
    retry: false
  });

  const unverified = history.error instanceof ApiError && history.error.field === 'phone_unverified';

  // Expired or signed with an old secret: forget it, the next order asks the code again.
  useEffect(() => {
    if (unverified) {
      savePhoneToken(props.phone, undefined);
    }
  }, [unverified, props.phone]);

  const repeat = (order: MyOrder) => {
    const { lines, missing } = repeatLines(order.items, props.products);

    props.cart.addAll(lines);

    if (missing.length) {
      setNotice({ code: order.code, missing });
      return;
    }

    props.onCheckout();
  };

  return (
    <Shell title="Meus pedidos" onClose={props.onClose}>
      <p className="border-b border-neutral-100 px-4 py-3 text-sm text-neutral-500 md:px-6">
        WhatsApp {formatPhone(props.phone)}
      </p>

      {history.isPending && <p className="p-6 text-sm text-neutral-500">Carregando…</p>}
      {history.isError && <p className="p-6 text-sm text-red-700">Não foi possível carregar seus pedidos.</p>}
      {history.data && !history.data.orders.length && (
        <p className="p-6 text-sm text-neutral-500">Você ainda não fez pedidos nesta loja.</p>
      )}

      <ul className="flex flex-col divide-y divide-neutral-100">
        {history.data?.orders.map((order) => {
          const available = repeatLines(order.items, props.products).lines.length > 0;

          return (
            <li key={order.code} className="flex flex-col gap-2 px-4 py-4 md:px-6">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold">Pedido #{order.code}</span>
                <span className="text-xs text-neutral-500">{WHEN.format(new Date(order.placed_at))}</span>
              </div>
              <span className="text-xs font-medium text-neutral-600">
                {STATUS_TEXT[order.status]} ·{' '}
                {order.source === 'web' ? 'pelo site' : order.source === 'pos' ? 'no balcão' : 'pelo WhatsApp'}
              </span>
              <ul className="flex flex-col gap-0.5 text-sm text-neutral-700">
                {order.items.map((item, index) => (
                  <li key={index}>
                    {item.qty}x {item.name}
                    {item.options && <span className="text-neutral-500"> ({item.options})</span>}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{formatMoney(order.total_cents)}</span>
                {props.open && (
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => repeat(order)}
                    className="h-9 rounded-lg border border-accent px-3 text-sm font-semibold text-accent-fg disabled:border-neutral-300 disabled:text-neutral-400"
                  >
                    {available ? 'Pedir de novo' : 'Itens indisponíveis'}
                  </button>
                )}
              </div>
              {notice?.code === order.code && (
                <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <span>
                    Adicionamos ao carrinho o que ainda está no cardápio. Fora do cardápio agora:{' '}
                    {notice.missing.join(', ')}.
                  </span>
                  <button type="button" onClick={props.onCheckout} className="self-start font-semibold underline">
                    Ver pedido
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!props.open && (
        <p className="px-4 py-4 text-sm text-neutral-500 md:px-6">
          A loja está fechada agora: dá para pedir de novo quando abrir.
        </p>
      )}
    </Shell>
  );
}
