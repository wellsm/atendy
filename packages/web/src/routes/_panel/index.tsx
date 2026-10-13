import type { OrderScope, OrderStatus, PanelOrder } from '../../lib/queries';

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { Loading } from '../../components/loading';
import { ApiError } from '../../lib/api';
import { formatMoney, formatPhone, formatWhen, PAYMENT_LABEL, STATUS_LABEL } from '../../lib/format';
import { useOrders, useUpdateOrder } from '../../lib/queries';
import { playBeep, unlockSound } from '../../lib/sound';

export const Route = createFileRoute('/_panel/')({
  component: Orders
});

const SOUND_KEY = 'atendy:sound';

const readSoundPreference = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
};

const writeSoundPreference = (on: boolean) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: the toggle still works for this visit.
  }
};

function Orders() {
  const [scope, setScope] = useState<OrderScope>('open');
  const [sound, setSound] = useState(false);
  const [notice, setNotice] = useState<string>();
  const orders = useOrders(scope);
  const openOrders = useOrders('open');
  const seen = useRef<Set<string>>(undefined);

  useEffect(() => setSound(readSoundPreference()), []);

  // The preference is remembered, but browsers unlock audio only after a gesture on this visit: the first click
  // or key anywhere on the page does it.
  useEffect(() => {
    if (!sound) {
      return;
    }

    const unlock = () => void unlockSound();

    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [sound]);

  // Beep for every new order that shows up after the first load.
  useEffect(() => {
    const data = openOrders.data?.orders;

    if (!data) {
      return;
    }

    const placed = data.filter(({ status }) => status === 'placed').map(({ id }) => id);

    if (seen.current && sound && placed.some((id) => !seen.current!.has(id))) {
      playBeep();
    }

    seen.current = new Set([...(seen.current ?? []), ...placed]);
  }, [openOrders.data, sound]);

  const toggleSound = async () => {
    const next = !sound;

    if (next) {
      await unlockSound();
      playBeep();
    }

    setSound(next);
    writeSoundPreference(next);
  };

  return (
    <section>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <button
          type="button"
          onClick={() => void toggleSound()}
          className={
            sound
              ? 'rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-800'
              : 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700'
          }
        >
          {sound ? 'Som ativado' : 'Ativar som'}
        </button>
      </header>

      <div className="mt-4 inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
        {(['open', 'closed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setScope(value)}
            className={
              scope === value
                ? 'rounded-md bg-red-600 px-3 py-1.5 font-medium text-white'
                : 'px-3 py-1.5 text-neutral-700'
            }
          >
            {value === 'open' ? 'Em aberto' : 'Finalizados'}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(undefined)} className="font-medium">
            Ok
          </button>
        </div>
      )}

      <div className="mt-4">
        {orders.isPending && <Loading />}

        {orders.isError && <p className="text-sm text-red-700">Não foi possível carregar os pedidos.</p>}

        {orders.data?.orders.length === 0 && (
          <p className="text-sm text-neutral-500">
            {scope === 'open' ? 'Nenhum pedido em aberto.' : 'Nenhum pedido finalizado ainda.'}
          </p>
        )}

        <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.data?.orders.map((order) => (
            <OrderCard key={order.id} order={order} onNotice={setNotice} />
          ))}
        </ul>
      </div>
    </section>
  );
}

type Action = { status: OrderStatus; label: string; primary?: boolean };

const actionsFor = (order: PanelOrder): Action[] => {
  switch (order.status) {
    case 'placed':
      return [{ status: 'accepted', label: 'Aceitar', primary: true }];
    case 'accepted':
      return [
        {
          status: 'out',
          label: order.fulfillment === 'pickup' ? 'Pronto para retirada' : 'Saiu para entrega',
          primary: true
        }
      ];
    case 'out':
      return [{ status: 'done', label: 'Concluir', primary: true }];
    default:
      return [];
  }
};

const STATUS_CHIP: Record<OrderStatus, string> = {
  placed: 'bg-red-100 text-red-800',
  accepted: 'bg-amber-100 text-amber-800',
  out: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  canceled: 'bg-neutral-200 text-neutral-700'
};

function OrderCard({ order, onNotice }: { order: PanelOrder; onNotice: (text: string) => void }) {
  const update = useUpdateOrder();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const open = order.status === 'placed' || order.status === 'accepted' || order.status === 'out';

  const move = (status: OrderStatus) => {
    setConfirmCancel(false);

    update.mutate(
      { orderId: order.id, status },
      {
        onSuccess: ({ notified }) => {
          if (!notified && status !== 'done') {
            onNotice('Status atualizado, mas o cliente não foi avisado no WhatsApp. Avise pela conversa.');
          }
        },
        onError: (error) => {
          onNotice(
            error instanceof ApiError && error.status === 409
              ? 'Esse pedido já tinha mudado. A lista foi atualizada.'
              : 'Não foi possível atualizar o pedido. Tente novamente.'
          );
        }
      }
    );
  };

  return (
    <li className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{order.customer.name ?? formatPhone(order.customer.phone)}</p>
          <p className="text-xs text-neutral-500">
            {formatPhone(order.customer.phone)} · {formatWhen(order.placed_at)} · #{order.id.slice(0, 4)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </span>
          {order.amended_at && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
              Pedido alterado
            </span>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-2 border-t border-neutral-100 pt-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <div className="min-w-0">
              <p>
                <span className="font-medium">{item.qty}x</span> {item.name}
              </p>
              {item.options && <p className="text-xs text-neutral-500">{item.options}</p>}
              {item.notes && <p className="text-xs text-amber-800">Obs.: {item.notes}</p>}
            </div>
            <span className="shrink-0 text-neutral-700">{formatMoney(item.qty * item.unit_price_cents)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">{order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}</dt>
          <dd className="text-right">
            {order.fulfillment === 'delivery'
              ? [order.address, order.neighborhood].filter(Boolean).join(' · ')
              : 'Cliente retira na loja'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-neutral-500">Pagamento</dt>
          <dd className="text-right">
            {order.payment_method ? PAYMENT_LABEL[order.payment_method] : '—'}
            {order.change_for_cents != null && ` (troco para ${formatMoney(order.change_for_cents)})`}
          </dd>
        </div>
        {order.fee_cents > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-neutral-500">Taxa de entrega</dt>
            <dd>{formatMoney(order.fee_cents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 font-semibold">
          <dt>Total</dt>
          <dd>{formatMoney(order.total_cents)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actionsFor(order).map((action) => (
          <button
            key={action.status}
            type="button"
            disabled={update.isPending}
            onClick={() => move(action.status)}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}

        {open && !confirmCancel && (
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => setConfirmCancel(true)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:opacity-50"
          >
            Cancelar
          </button>
        )}

        {confirmCancel && (
          <>
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => move('canceled')}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
            >
              Confirmar cancelamento
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="px-2 py-2 text-sm text-neutral-600"
            >
              Voltar
            </button>
          </>
        )}

        <Link
          to="/conversas"
          search={{ c: order.conversation_id }}
          className="ml-auto text-sm font-medium text-red-700 hover:underline"
        >
          Ver conversa
        </Link>
      </div>
    </li>
  );
}
