import { useState } from 'react';

import { formatWhen } from '../../lib/format';
import { useStaff, useStoreStockMovements } from '../../lib/queries';
import { authorName } from '../../lib/staff';
import { formatQty, LOSS_REASONS, MOVEMENT_LABELS } from '../../lib/stock';
import { Loading } from '../loading';

const FILTERS: [string | undefined, string][] = [
  [undefined, 'Tudo'],
  ['purchase', 'Entradas'],
  ['loss', 'Perdas'],
  ['count', 'Contagens'],
  ['sale', 'Vendas']
];

const KIND_CLASS: Record<string, string> = {
  purchase: 'bg-ok-bg text-ok-fg',
  loss: 'bg-danger-soft text-danger-fg',
  count: 'bg-out-bg text-out-fg'
};

/**
 * Order movements carry the system author; a person's id is an employee or the owner's Clerk user.
 */
const SYSTEM_AUTHORS: Record<string, string> = { system: 'Pedido', demo: 'Demo' };

/**
 * "Histórico": every stock movement of the store, newest first, by kind.
 */
export function StockHistory({ hidden }: { hidden: boolean }) {
  const [kind, setKind] = useState<string>();
  const movements = useStoreStockMovements(kind);
  const staff = useStaff();
  const rows = movements.data?.pages.flatMap((page) => page.movements) ?? [];

  return (
    <div className={`min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5 ${hidden ? 'hidden' : 'flex'}`}>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
              kind === value ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2 hover:bg-line'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {movements.isPending && <Loading />}
      {movements.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o histórico.</p>}
      {movements.isSuccess && !rows.length && <p className="text-sm text-muted">Nenhuma movimentação.</p>}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="hidden grid-cols-[130px_100px_minmax(0,1.2fr)_minmax(0,1.4fr)_110px_110px_110px] gap-3 border-b border-line bg-hover px-4 py-2 text-xs text-muted md:grid">
            <span>Quando</span>
            <span>Tipo</span>
            <span>Item</span>
            <span>Detalhe</span>
            <span>Quantidade</span>
            <span>Saldo após</span>
            <span>Por</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const reason = LOSS_REASONS.find(([value]) => value === row.reason)?.[1] ?? row.reason;
              const detail = [reason, row.note].filter(Boolean).join(' · ');
              const by = SYSTEM_AUTHORS[row.author ?? ''] ?? authorName(row.author, staff.data?.staff) ?? 'Funcionário';

              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm md:grid-cols-[130px_100px_minmax(0,1.2fr)_minmax(0,1.4fr)_110px_110px_110px] md:items-center"
                >
                  <span className="text-xs text-muted md:text-sm">{formatWhen(row.created_at)}</span>
                  <span className="justify-self-end md:justify-self-start">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLASS[row.kind] ?? 'bg-surface-2 text-fg-2'}`}
                    >
                      {MOVEMENT_LABELS[row.kind] ?? row.kind}
                    </span>
                  </span>
                  <span className="truncate font-medium">{row.item_name}</span>
                  <span className="truncate text-muted">{detail || '—'}</span>
                  <span className={`tabular-nums ${row.qty_delta < 0 ? 'text-danger-fg' : 'text-ok-fg'}`}>
                    {row.qty_delta > 0 ? '+' : ''}
                    {formatQty(row.qty_delta, row.item_unit)}
                  </span>
                  <span className="text-muted tabular-nums">{formatQty(row.balance_after, row.item_unit)}</span>
                  <span className="truncate text-xs text-muted md:text-sm">{by}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {movements.hasNextPage && (
        <button
          type="button"
          disabled={movements.isFetchingNextPage}
          onClick={() => void movements.fetchNextPage()}
          className="h-9 self-start rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover disabled:opacity-50"
        >
          {movements.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  );
}
