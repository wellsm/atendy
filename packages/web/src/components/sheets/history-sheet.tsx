import type { PanelOrder } from '../../lib/queries';

import { useState } from 'react';

import { Sheet, SheetHeader } from './sheet';
import { formatMoney, formatPhone, formatWhen, STATUS_LABEL } from '../../lib/format';
import { usePanelNavigate } from '../../lib/panel-search';
import { useOrders } from '../../lib/queries';
import { STATUS_CHIP } from '../conversations/order-panel';
import { Loading } from '../loading';

type Tab = 'all' | 'open' | 'done' | 'canceled' | 'abandoned';

const TABS: [Tab, string][] = [
  ['all', 'Todos'],
  ['open', 'Em aberto'],
  ['done', 'Concluídos'],
  ['canceled', 'Cancelados'],
  ['abandoned', 'Abandonados']
];

/**
 * When the order happened: placed, or when the customer left the draft.
 */
const orderTime = (order: PanelOrder) => order.placed_at ?? order.abandoned_at;

const fulfillmentText = (order: PanelOrder) =>
  order.fulfillment === 'pickup' ? 'Retirada' : order.fulfillment === 'delivery' ? 'Entrega' : '—';

const COLUMNS = 'md:grid md:grid-cols-[80px_minmax(0,1.2fr)_minmax(0,2fr)_90px_100px_110px] md:gap-3';

const summary = (order: PanelOrder) => order.items.map((item) => `${item.qty}x ${item.name}`).join(', ');

const inTab = (order: PanelOrder, tab: Tab) => {
  if (tab === 'all') {
    return true;
  }

  if (tab === 'open') {
    return ['placed', 'accepted', 'out'].includes(order.status);
  }

  return order.status === tab;
};

/**
 * Open and finished orders, newest first; a row opens its conversation.
 */
export function HistorySheet({ onClose }: { onClose: () => void }) {
  const navigate = usePanelNavigate();
  const openOrders = useOrders('open');
  const closedOrders = useOrders('closed');
  const [tab, setTab] = useState<Tab>('all');
  const orders = [...(openOrders.data?.orders ?? []), ...(closedOrders.data?.orders ?? [])]
    .filter((order) => inTab(order, tab))
    .sort((a, b) => (orderTime(b) ?? '').localeCompare(orderTime(a) ?? ''));

  return (
    <Sheet width="lg" label="Histórico de pedidos" onClose={onClose}>
      <SheetHeader title="Histórico de pedidos" onClose={onClose} />

      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-3 [scrollbar-width:none] md:px-6">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${tab === value ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`hidden border-b border-line bg-hover px-6 py-2.5 text-xs text-muted ${COLUMNS}`}>
        <span>Pedido</span>
        <span>Cliente</span>
        <span>Itens</span>
        <span>Tipo</span>
        <span className="text-right">Total</span>
        <span className="text-right">Status</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(openOrders.isPending || closedOrders.isPending) && <Loading />}

        {(openOrders.isError || closedOrders.isError) && (
          <p className="p-6 text-sm text-accent-fg">Não foi possível carregar os pedidos.</p>
        )}

        {openOrders.data && closedOrders.data && orders.length === 0 && (
          <p className="p-6 text-sm text-muted">Nenhum pedido aqui.</p>
        )}

        {orders.map((order) => {
          const name = order.customer.name ?? formatPhone(order.customer.phone);
          const code = `#${order.code}`;
          const chip = `rounded-full font-medium ${STATUS_CHIP[order.status]}`;

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => void navigate({ c: order.conversation_id })}
              className={`flex w-full items-center gap-2.5 border-b border-line px-4 py-3 text-left hover:bg-hover md:px-6 md:text-[13px] ${COLUMNS}`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:hidden">
                <span className="truncate text-[15px] font-semibold">{name}</span>
                <span className="truncate text-xs text-muted">
                  {code} · {formatWhen(orderTime(order))} · {summary(order)}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1 md:hidden">
                <b className="text-sm font-semibold">{formatMoney(order.total_cents)}</b>
                <span className={`px-[7px] py-px text-[11px] ${chip}`}>{STATUS_LABEL[order.status]}</span>
              </span>

              <span className="hidden flex-col gap-0.5 text-fg-2 md:flex">
                <span className="font-mono">
                  {code}
                  {order.source === 'web' && <span className="ml-1 font-sans text-[11px] text-out-fg">site</span>}
                </span>
                <span className="text-xs text-faint">{formatWhen(orderTime(order))}</span>
              </span>
              <span className="hidden truncate font-medium md:block">{name}</span>
              <span className="hidden truncate text-fg-2 md:block">{summary(order)}</span>
              <span className="hidden text-fg-2 md:block">{fulfillmentText(order)}</span>
              <span className="hidden text-right font-semibold md:block">{formatMoney(order.total_cents)}</span>
              <span className={`hidden justify-self-end px-2 py-0.5 text-xs md:block ${chip}`}>
                {STATUS_LABEL[order.status]}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
