import type { OrderStatus, PanelOrder } from '../../lib/queries';

import { useState } from 'react';

import { OrderEditor } from './order-editor';
import { ApiError } from '../../lib/api';
import { formatMoney, formatWhen, PAYMENT_LABEL, STATUS_LABEL } from '../../lib/format';
import { useAssignCourier, useStaff, useUpdateOrder } from '../../lib/queries';
import { authorName } from '../../lib/staff';

export const STATUS_CHIP: Record<OrderStatus, string> = {
  placed: 'bg-placed-bg text-placed-fg',
  accepted: 'bg-accepted-bg text-accepted-fg',
  out: 'bg-out-bg text-out-fg',
  done: 'bg-done-bg text-done-fg',
  canceled: 'bg-canceled-bg text-canceled-fg',
  abandoned: 'bg-surface-2 text-muted'
};

const OPEN_STATUSES: OrderStatus[] = ['placed', 'accepted', 'out'];

const nextAction = (order: PanelOrder): { status: OrderStatus; label: string } | undefined => {
  switch (order.status) {
    case 'placed':
      return { status: 'accepted', label: 'Aceitar pedido' };
    case 'accepted':
      return {
        status: 'out',
        label:
          order.source === 'pos'
            ? 'Pronto'
            : order.fulfillment === 'pickup'
              ? 'Pronto para retirada'
              : 'Saiu para entrega'
      };
    case 'out':
      return { status: 'done', label: 'Concluir' };
    default:
      return undefined;
  }
};

/**
 * Status changes of the conversation's order. `onChanged` refetches the thread, where the customer notice lands.
 */
export const useOrderStatus = (onChanged: () => void) => {
  const update = useUpdateOrder();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<string>();

  const move = (order: PanelOrder, status: OrderStatus, courierId?: string) => {
    setConfirmCancel(false);
    setNotice(undefined);

    update.mutate(
      { orderId: order.id, status, courierId },
      {
        onSuccess: ({ notified }) => {
          if (!notified && status !== 'done') {
            setNotice('Status atualizado, mas o cliente não foi avisado no WhatsApp. Avise pela conversa.');
          }
        },
        onError: (error) =>
          setNotice(
            error instanceof ApiError && error.status === 409
              ? 'Esse pedido já tinha mudado. A lista foi atualizada.'
              : error instanceof ApiError && error.field === 'forbidden'
                ? 'Sem permissão.'
                : 'Não foi possível atualizar o pedido. Tente novamente.'
          ),
        onSettled: onChanged
      }
    );
  };

  return { move, pending: update.isPending, confirmCancel, setConfirmCancel, notice };
};

export type OrderStatusControls = ReturnType<typeof useOrderStatus>;

const orderCode = (order: PanelOrder) => order.code;

const placedLabel = (iso: string | null) => {
  if (!iso) {
    return '';
  }

  const today = new Date(iso).toDateString() === new Date().toDateString();

  return `Feito ${today ? 'às' : 'em'} ${formatWhen(iso)}`;
};

export function StatusChip({ status, className = '' }: { status: OrderStatus; className?: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[status]} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Steps({ order }: { order: PanelOrder }) {
  const current = OPEN_STATUSES.indexOf(order.status);
  const labels = [
    'Novo',
    'Em preparo',
    order.fulfillment === 'pickup' || order.source === 'pos' ? 'Pronto' : 'Saiu',
    'Concluído'
  ];

  return (
    <ol className="grid grid-cols-4 gap-1">
      {labels.map((label, index) => (
        <li key={label} className="flex flex-col gap-1.5">
          <span className={`h-1 rounded ${index <= current ? 'bg-accent' : 'bg-line'}`} />
          <span
            className={`text-[11px] ${index <= current ? 'text-fg' : 'text-faint'} ${index === current ? 'font-semibold' : ''}`}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Items({ order }: { order: PanelOrder }) {
  return (
    <ul className="space-y-2.5 text-sm">
      {order.items.map((item) => (
        <li key={item.id} className="flex justify-between gap-3">
          <div className="min-w-0">
            <p>
              <span className="font-semibold">{item.qty}x</span> {item.name}
            </p>
            {item.options && <p className="text-xs text-muted">{item.options}</p>}
            {item.notes && <p className="text-xs text-warn-fg">Obs.: {item.notes}</p>}
          </div>
          <span className="shrink-0 text-fg-2">{formatMoney(item.qty * item.unit_price_cents)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Summary({ order, withTotals }: { order: PanelOrder; withTotals: boolean }) {
  const staff = useStaff().data?.staff;
  const madeBy = authorName(order.created_by, staff);
  const canceledBy = authorName(order.canceled_by, staff);

  return (
    <dl className="space-y-1.5 text-[13px]">
      <div className="flex justify-between gap-3">
        <dt className="text-muted">
          {order.source === 'pos' ? 'Balcão' : order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}
        </dt>
        <dd className="text-right">
          {order.source === 'pos'
            ? 'Venda no balcão'
            : order.fulfillment === 'delivery'
              ? [order.address, order.neighborhood].filter(Boolean).join(' · ')
              : 'Cliente retira na loja'}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Pagamento</dt>
        <dd className="text-right">
          {order.payment_method ? PAYMENT_LABEL[order.payment_method] : order.source === 'pos' ? 'Pago no balcão' : '—'}
          {order.change_for_cents != null && ` (troco para ${formatMoney(order.change_for_cents)})`}
        </dd>
      </div>
      {madeBy && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Atendido por</dt>
          <dd className="text-right">{madeBy}</dd>
        </div>
      )}
      {canceledBy && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Cancelado por</dt>
          <dd className="text-right">{canceledBy}</dd>
        </div>
      )}
      {withTotals && order.fee_cents > 0 && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Taxa de entrega</dt>
          <dd>{formatMoney(order.fee_cents)}</dd>
        </div>
      )}
      {withTotals && (
        <div className="mt-1 flex justify-between gap-3 text-[15px] font-semibold">
          <dt>Total</dt>
          <dd>{formatMoney(order.total_cents)}</dd>
        </div>
      )}
    </dl>
  );
}

export function Notice({ text }: { text: string }) {
  return <p className="rounded-lg border border-warn-line bg-warn-bg px-2.5 py-2 text-xs text-warn-fg">{text}</p>;
}

/**
 * Delivery orders: the courier is picked when the order leaves ("Sem entregador" sends no message) and can be changed
 * while it is out. Employees come from `GET /panel/staff` (active couriers and active employees who deliver).
 */
function CourierPicker({
  order,
  value,
  onChange
}: {
  order: PanelOrder;
  value: string;
  onChange: (id: string) => void;
}) {
  const couriers = (useStaff().data?.staff ?? []).filter(
    (member) => member.active && (member.role === 'courier' || member.delivers)
  );
  const assign = useAssignCourier();
  const out = order.status === 'out';

  if (!couriers.length && !order.courier) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {out ? `Entregador: ${order.courier?.name ?? 'sem entregador'}` : 'Quem vai levar?'}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-[38px] rounded-lg border border-line-2 bg-surface px-2 text-sm text-fg"
        >
          <option value="">{out ? 'Escolher outro…' : 'Sem entregador'}</option>
          {couriers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      {out && value && value !== order.courier?.id && (
        <button
          type="button"
          disabled={assign.isPending}
          onClick={() => assign.mutate({ orderId: order.id, courierId: value }, { onSuccess: () => onChange('') })}
          className="h-[38px] rounded-lg border border-line-2 text-[13px] font-medium hover:bg-hover disabled:opacity-50"
        >
          Trocar entregador
        </button>
      )}
      {assign.isError && <Notice text="Não foi possível trocar o entregador." />}
    </div>
  );
}

export function Actions({
  order,
  controls,
  compact
}: {
  order: PanelOrder;
  controls: OrderStatusControls;
  compact: boolean;
}) {
  const { move, pending, confirmCancel, setConfirmCancel } = controls;
  const action = nextAction(order);
  const [courierId, setCourierId] = useState('');
  const delivery = order.fulfillment === 'delivery' && order.source !== 'pos';

  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
      {delivery && (order.status === 'accepted' || order.status === 'out') && (
        <div className={compact ? 'w-full' : undefined}>
          <CourierPicker order={order} value={courierId} onChange={setCourierId} />
        </div>
      )}
      {action && (
        <button
          type="button"
          disabled={pending}
          onClick={() => move(order, action.status, action.status === 'out' ? courierId || undefined : undefined)}
          className={`rounded-lg bg-accent text-sm font-semibold text-white disabled:opacity-50 ${compact ? 'h-11 flex-1' : 'h-[42px]'}`}
        >
          {action.label}
        </button>
      )}

      {/* A paid counter sale is canceled from the POS (reason, refunds); the board's cancel would get a 409. */}
      {order.source === 'pos' ? null : !confirmCancel ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmCancel(true)}
          className={`rounded-lg border border-line-2 bg-surface text-[13px] text-fg-2 disabled:opacity-50 ${compact ? 'h-11 px-3.5' : 'h-[38px]'}`}
        >
          {compact ? 'Cancelar' : 'Cancelar pedido'}
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => move(order, 'canceled')}
            className={`flex-1 rounded-lg border border-danger-line bg-danger-soft px-3 text-[13px] font-medium text-danger-fg disabled:opacity-50 ${compact ? 'h-11' : 'h-[38px]'}`}
          >
            {compact ? 'Confirmar' : 'Confirmar cancelamento'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmCancel(false)}
            className={`px-2 text-[13px] text-muted ${compact ? 'h-11' : 'h-[38px]'}`}
          >
            Voltar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Side column (wide screens): customer, open order with its actions, the order editor while a person handles the
 * conversation (unless an order waits for acceptance: that one is the current order), and previous orders.
 */
export function OrderAside({
  conversationId,
  human,
  name,
  phone,
  order,
  history,
  controls
}: {
  conversationId: string;
  human: boolean;
  name: string;
  phone: string;
  order: PanelOrder | undefined;
  history: PanelOrder[];
  controls: OrderStatusControls;
}) {
  const editing = human && order?.status !== 'placed';

  return (
    <aside className="hidden w-[350px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface xl:flex">
      <div className="flex flex-col gap-1 border-b border-line px-5 py-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Cliente</span>
        <span className="font-semibold">{name}</span>
        <span className="text-[13px] text-muted">{phone}</span>
      </div>

      {order ? (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[15px] font-semibold">Pedido #{orderCode(order)}</span>
            {order.source === 'web' && (
              <span className="rounded-full bg-out-bg px-2 py-0.5 text-xs font-medium text-out-fg">Site</span>
            )}
            {order.amended_at && (
              <span className="rounded-full bg-amend-bg px-2 py-0.5 text-xs font-medium text-amend-fg">
                Pedido alterado
              </span>
            )}
            <StatusChip status={order.status} />
          </div>
          <Steps order={order} />
          <span className="-mt-2 text-xs text-muted">{placedLabel(order.placed_at)}</span>
          <div className="border-t border-line pt-3.5">
            <Items order={order} />
          </div>
          <div className="border-t border-line pt-3.5">
            <Summary order={order} withTotals />
          </div>
          {controls.notice && <Notice text={controls.notice} />}
          <Actions order={order} controls={controls} compact={false} />
        </div>
      ) : editing ? null : (
        <div className="flex flex-col gap-1.5 p-5">
          <span className="text-[15px] font-semibold">Nenhum pedido em aberto</span>
          <span className="text-[13px] leading-relaxed text-muted">
            Quando o cliente fechar um pedido nesta conversa, ele aparece aqui para você acompanhar.
          </span>
          {controls.notice && <Notice text={controls.notice} />}
        </div>
      )}

      {editing && (
        <div className={order ? 'border-t border-line' : undefined}>
          <OrderEditor conversationId={conversationId} />
        </div>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Pedidos anteriores</span>
          {history.map((past) => (
            <div key={past.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-fg-2">
                #{orderCode(past)} · {formatWhen(past.placed_at ?? past.abandoned_at)}
              </span>
              <StatusChip status={past.status} className="text-[11px]" />
              <span className="font-medium">{formatMoney(past.total_cents)}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

/**
 * Collapsible bar above the thread (phones and narrow desktops) with the same order and actions.
 */
export function OrderBar({ order, controls }: { order: PanelOrder; controls: OrderStatusControls }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-b border-line bg-surface xl:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <StatusChip status={order.status} className="text-[11px]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Pedido #{orderCode(order)}</span>
        <span className="text-sm font-semibold">{formatMoney(order.total_cents)}</span>
        <span className="w-3.5 text-center text-xs text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {/* The notice shows even collapsed: the store must know the customer was not told. */}
      {!open && controls.notice && (
        <div className="px-3.5 pb-3">
          <Notice text={controls.notice} />
        </div>
      )}

      {open && (
        <div className="flex max-h-[26rem] flex-col gap-2.5 overflow-y-auto px-3.5 pb-3.5">
          <Steps order={order} />
          <Items order={order} />
          <div className="border-t border-line pt-2.5">
            <Summary order={order} withTotals={false} />
          </div>
          {controls.notice && <Notice text={controls.notice} />}
          <Actions order={order} controls={controls} compact />
        </div>
      )}
    </div>
  );
}
