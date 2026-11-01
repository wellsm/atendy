import type { StaffMember } from '../../lib/queries';

import { useState } from 'react';

import { formatMoney, formatWhen } from '../../lib/format';
import { useCourierPending, useCourierSettlements, useSettleCourier, useStaff } from '../../lib/queries';
import { authorName } from '../../lib/staff';
import { Loading } from '../loading';

const INPUT = 'rounded-lg border border-line-2 px-2 py-1.5 text-sm focus:border-accent focus:outline-none';

const today = () => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// Local day boundaries as ISO instants.
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/**
 * "Acerto" of a courier: delivered orders of the period, the cash held minus the fees owed, and past settlements.
 */
export function CourierSettlement({ member }: { member: StaffMember }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const pending = useCourierPending(member.id, dayStart(from), dayEnd(to));
  const history = useCourierSettlements(member.id);
  const staff = useStaff();
  const settle = useSettleCourier();

  const data = pending.data;

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        <span>até</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={INPUT} />
      </div>

      {pending.isLoading && <Loading />}

      {data && !data.orders.length && <p className="text-sm text-muted">Nenhuma entrega a acertar no período.</p>}

      {data && data.orders.length > 0 && (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {data.orders.map((order) => (
              <li key={order.id} className="flex justify-between gap-2">
                <span>
                  #{order.code} · {formatWhen(order.delivered_at)}
                </span>
                <span className="text-muted">
                  taxa {formatMoney(order.fee_cents)}
                  {order.cash_cents > 0 && ` · dinheiro ${formatMoney(order.cash_cents)}`}
                </span>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm font-medium">
            <dt>Taxas a pagar</dt>
            <dd>{formatMoney(data.fees_cents)}</dd>
            <dt>Dinheiro com o entregador</dt>
            <dd>{formatMoney(data.cash_cents)}</dd>
            <dt>{data.net_cents >= 0 ? 'Entregador repassa' : 'Loja paga ao entregador'}</dt>
            <dd>{formatMoney(Math.abs(data.net_cents))}</dd>
          </dl>

          <button
            type="button"
            disabled={settle.isPending}
            onClick={() => settle.mutate({ id: member.id, order_ids: data.orders.map(({ id }) => id) })}
            className="h-9 self-start rounded-lg bg-accent px-3 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            Acertar
          </button>
        </>
      )}

      {settle.isError && (
        <p className="text-sm text-danger-fg">Não foi possível acertar. Atualize a lista e tente de novo.</p>
      )}

      {history.data && history.data.settlements.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted">Acertos anteriores</p>
          <ul className="flex flex-col gap-1 text-sm">
            {history.data.settlements.map((item) => (
              <li key={item.id} className="flex justify-between gap-2">
                <span>
                  {formatWhen(item.created_at)} · {item.orders_count} entrega(s)
                  {authorName(item.settled_by, staff.data?.staff) &&
                    ` · ${authorName(item.settled_by, staff.data?.staff)}`}
                </span>
                <span className="text-muted">taxas {formatMoney(item.fees_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
