import type { OrderStatus, PanelOrder } from '../../lib/queries';

import { useEffect, useRef, useState } from 'react';

import { formatWhen, orderCustomerName } from '../../lib/format';
import { usePanelNavigate } from '../../lib/panel-search';
import { Actions, Items, Notice, Summary, useOrderStatus } from '../conversations/order-panel';

const STAGES = [
  { status: 'placed', title: 'Novos', dot: 'bg-accent', empty: 'Nenhum pedido novo.' },
  { status: 'accepted', title: 'Em preparo', dot: 'bg-amber-500', empty: 'Nada em preparo.' },
  { status: 'out', title: 'Saiu / pronto', dot: 'bg-out-fg', empty: 'Nada na rua.' }
] as const;

/**
 * Ids of the placed orders that showed up after the first load, for a short highlight.
 */
const useFreshOrders = (orders: PanelOrder[]) => {
  const seen = useRef<Set<string>>(undefined);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    const placed = orders.filter(({ status }) => status === 'placed').map(({ id }) => id);
    const arrived = seen.current ? placed.filter((id) => !seen.current!.has(id)) : [];

    if (arrived.length) {
      setFresh(new Set(arrived));
    }

    seen.current = new Set([...(seen.current ?? []), ...placed]);
  }, [orders]);

  useEffect(() => {
    if (!fresh.size) {
      return;
    }

    const timer = setTimeout(() => setFresh(new Set()), 2600);

    return () => clearTimeout(timer);
  }, [fresh]);

  return fresh;
};

/**
 * The kitchen view: open orders by stage. Desktop: one column per stage. Phone: stage pills and the picked stage.
 */
export function OrderBoard({ orders }: { orders: PanelOrder[] }) {
  const [picked, setPicked] = useState<OrderStatus>('placed');
  const fresh = useFreshOrders(orders);
  const columns = STAGES.map((stage) => ({ ...stage, orders: orders.filter(({ status }) => status === stage.status) }));

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-5">
      <div className="flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] lg:hidden">
        {columns.map((column) => (
          <button
            key={column.status}
            type="button"
            onClick={() => setPicked(column.status)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium ${picked === column.status ? 'bg-fg text-surface' : 'bg-surface text-fg-2'}`}
          >
            <span className={`size-[7px] rounded-full ${column.dot}`} />
            {column.title} · {column.orders.length}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        {columns.map((column) => (
          <div
            key={column.status}
            className={`min-h-0 flex-col lg:flex lg:rounded-[14px] lg:bg-surface-2 ${picked === column.status ? 'flex' : 'hidden'}`}
          >
            <div className="hidden shrink-0 items-center gap-2 px-3.5 py-3 lg:flex">
              <span className={`size-2 rounded-full ${column.dot}`} />
              <span className="text-sm font-semibold">{column.title}</span>
              <span className="text-[13px] text-muted">{column.orders.length}</span>
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-4 lg:px-2.5">
              {column.orders.length === 0 && (
                <li className="rounded-xl border border-dashed border-line-2 px-3 py-7 text-center text-sm text-faint lg:py-6 lg:text-[13px]">
                  {column.empty}
                </li>
              )}
              {column.orders.map((order) => (
                <OrderCard key={order.id} order={order} fresh={fresh.has(order.id)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One open order: items, delivery and payment, the next stage and cancel, and a link to its conversation.
 */
function OrderCard({ order, fresh }: { order: PanelOrder; fresh: boolean }) {
  const navigate = usePanelNavigate();
  const controls = useOrderStatus(() => undefined);
  const conversationId = order.conversation_id;

  return (
    <li
      className={`flex shrink-0 flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 transition-shadow duration-400 ${fresh ? 'ring-3 ring-accent-line' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold">{orderCustomerName(order)}</span>
          <span className="text-xs text-muted">
            {formatWhen(order.placed_at)} · #{order.code}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-2">
            {order.source === 'pos' ? 'Balcão' : order.fulfillment === 'pickup' ? 'Retirada' : 'Entrega'}
          </span>
          {order.amended_at && (
            <span className="rounded-full bg-amend-bg px-[7px] py-px text-[11px] font-medium text-amend-fg">
              Pedido alterado
            </span>
          )}
          {order.source === 'web' && (
            <span className="rounded-full bg-out-bg px-[7px] py-px text-[11px] font-medium text-out-fg">Site</span>
          )}
        </div>
      </div>

      <div className="border-t border-line pt-2.5">
        <Items order={order} />
      </div>

      <div className="border-t border-line pt-2.5">
        <Summary order={order} withTotals />
      </div>

      {controls.notice && <Notice text={controls.notice} />}

      <Actions order={order} controls={controls} compact />

      {conversationId && (
        <button
          type="button"
          onClick={() => void navigate({ c: conversationId })}
          className="-mt-1 self-start text-[13px] font-medium text-accent-fg"
        >
          Ver conversa →
        </button>
      )}
    </li>
  );
}
