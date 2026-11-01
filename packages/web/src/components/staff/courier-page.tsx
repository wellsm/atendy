import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, getPublic, postPublic } from '../../lib/api';
import { formatMoney, formatWhen, PAYMENT_LABEL } from '../../lib/format';
import { Loading } from '../loading';

type CourierOrder = {
  id: string;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  neighborhood: string | null;
  total_cents: number;
  payment_method: string | null;
  change_for_cents: number | null;
  fee_cents: number | null;
  notes: string | null;
};

type CourierData = {
  store_name: string;
  courier_name: string;
  open: CourierOrder[];
  delivered_today: { code: string; delivered_at: string; fee_cents: number | null }[];
};

const LINK = 'flex h-11 flex-1 items-center justify-center rounded-lg border border-line-2 text-sm font-medium';

const POSITION_WAIT_MS = 3000;

/**
 * The browser position once, within 3 s of wall clock (the permission prompt included: the API's `timeout` starts
 * only after it); a refusal or timeout sends the delivery without it.
 */
const currentPosition = () =>
  new Promise<{ lat: number; lng: number } | undefined>((resolve) => {
    if (!navigator.geolocation) {
      resolve(undefined);

      return;
    }

    setTimeout(() => resolve(undefined), POSITION_WAIT_MS);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(undefined),
      { timeout: POSITION_WAIT_MS, maximumAge: 60_000 }
    );
  });

function OrderCard({ order, token }: { order: CourierOrder; token: string }) {
  const queryClient = useQueryClient();
  const address = [order.address, order.neighborhood].filter(Boolean).join(', ');
  const query = encodeURIComponent(address);
  const phoneDigits = order.customer_phone?.replace(/\D/g, '');
  // "Entreguei" is final (the order is done): the first tap only asks to confirm.
  const [confirming, setConfirming] = useState(false);

  const deliver = useMutation({
    mutationFn: async () =>
      postPublic(
        `/public/couriers/${encodeURIComponent(token)}/orders/${order.id}/delivered`,
        (await currentPosition()) ?? {}
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['courier', token] })
  });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-base font-semibold">Pedido #{order.code}</span>
        <span className="text-sm font-semibold">{formatMoney(order.total_cents)}</span>
      </div>

      <div className="text-sm">
        <p className="font-medium">{order.customer_name ?? 'Cliente'}</p>
        <p className="text-fg-2">{address || 'Sem endereço'}</p>
      </div>

      {order.notes && <p className="text-sm text-warn-fg">Obs.: {order.notes}</p>}

      <p className="text-sm text-fg-2">
        {order.payment_method ? PAYMENT_LABEL[order.payment_method] : 'Pagamento não informado'}
        {order.change_for_cents != null && ` · troco para ${formatMoney(order.change_for_cents)}`}
      </p>

      {address && (
        <div className="flex gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${query}`}
            target="_blank"
            rel="noreferrer"
            className={LINK}
          >
            Abrir no Google Maps
          </a>
          <a href={`https://waze.com/ul?q=${query}&navigate=yes`} target="_blank" rel="noreferrer" className={LINK}>
            Abrir no Waze
          </a>
        </div>
      )}

      {order.customer_phone && (
        <div className="flex gap-2">
          <a href={`tel:+${phoneDigits}`} className={LINK}>
            Ligar
          </a>
          <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className={LINK}>
            WhatsApp
          </a>
        </div>
      )}

      <div className="flex gap-2">
        {confirming && !deliver.isPending && (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-12 flex-1 rounded-lg border border-line-2 text-base font-medium"
          >
            Voltar
          </button>
        )}
        <button
          type="button"
          disabled={deliver.isPending}
          onClick={() => (confirming ? deliver.mutate() : setConfirming(true))}
          className="h-12 flex-[2] rounded-lg bg-accent text-base font-semibold text-white disabled:opacity-50"
        >
          {deliver.isPending ? 'Enviando…' : confirming ? 'Confirmar entrega' : 'Entreguei'}
        </button>
      </div>
      {deliver.isError && <p className="text-sm text-danger-fg">Não foi possível confirmar. Tente novamente.</p>}
    </li>
  );
}

/**
 * Public courier page (`/courier/<token>`, no login): the courier's open deliveries and today's finished ones.
 */
export function CourierPage({ token }: { token: string }) {
  const page = useQuery({
    queryKey: ['courier', token],
    queryFn: () => getPublic<CourierData>(`/public/couriers/${encodeURIComponent(token)}`),
    retry: false,
    refetchInterval: 30_000
  });

  if (page.isPending) {
    return <Loading />;
  }

  if (page.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">
          {page.error instanceof ApiError && page.error.status === 404 ? 'Link inválido' : 'Erro ao carregar'}
        </h1>
        <p className="text-sm text-muted">Peça um novo link para a loja.</p>
      </main>
    );
  }

  const { store_name, courier_name, open, delivered_today } = page.data;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-lg font-semibold">{store_name}</h1>
        <p className="text-sm text-muted">Entregas de {courier_name}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {open.map((order) => (
          <OrderCard key={order.id} order={order} token={token} />
        ))}
      </ul>
      {open.length === 0 && <p className="text-sm text-muted">Nenhuma entrega em andamento.</p>}

      {delivered_today.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Entregues hoje</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {delivered_today.map((row) => (
              <li key={row.code} className="flex justify-between rounded-lg border border-line px-3 py-2">
                <span>
                  #{row.code} · {formatWhen(row.delivered_at)}
                </span>
                {row.fee_cents != null && <span>{formatMoney(row.fee_cents)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
