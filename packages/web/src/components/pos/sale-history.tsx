import type { PosHeldSale } from '../../lib/queries';

import { useState } from 'react';

import { ApiError } from '../../lib/api';
import { formatMoney, formatWhen, STATUS_LABEL } from '../../lib/format';
import { useCancelPosSale, useFinalizedPosSales, useStaff } from '../../lib/queries';
import { authorName } from '../../lib/staff';

const ERROR_TEXT: Record<string, string> = {
  reason: 'Informe o motivo (até 200 caracteres).',
  cash_closed: 'Abra o caixa para cancelar esta venda.',
  not_draft: 'Esta venda já foi cancelada.',
  store_blocked: 'PDV indisponível: a loja está bloqueada.'
};

function SaleRow({ sale }: { sale: PosHeldSale }) {
  const cancel = useCancelPosSale();
  const staff = useStaff().data?.staff;
  const madeBy = authorName(sale.created_by, staff);
  const canceledBy = authorName(sale.canceled_by, staff);
  const [reason, setReason] = useState<string>();

  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">
            #{sale.code}
            {sale.label && <span className="font-normal text-muted"> · {sale.label}</span>}
          </span>
          <span className="text-xs text-muted">
            {formatWhen(sale.placed_at)} ·{' '}
            {sale.canceled_at ? 'Cancelada' : sale.status === 'out' ? 'Pronto' : STATUS_LABEL[sale.status]}
            {madeBy && ` · ${madeBy}`}
            {sale.canceled_at && canceledBy && ` · cancelada por ${canceledBy}`}
          </span>
        </span>
        <span className={`text-sm font-semibold tabular-nums ${sale.canceled_at ? 'text-muted line-through' : ''}`}>
          {formatMoney(sale.total_cents)}
        </span>
      </div>

      {!sale.canceled_at &&
        (reason === undefined ? (
          <button
            type="button"
            onClick={() => setReason('')}
            className="self-start text-[13px] font-medium text-accent-fg"
          >
            Cancelar venda
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              cancel.mutate({ sale_id: sale.id, reason: reason.trim() });
            }}
            className="flex flex-col gap-2"
          >
            <input
              value={reason}
              maxLength={200}
              autoFocus
              placeholder="Motivo do cancelamento"
              onChange={(event) => setReason(event.target.value)}
              className="h-10 rounded-lg border border-line-2 bg-surface px-3 text-sm focus:border-accent focus:outline-none"
            />
            {cancel.isError && (
              <p className="text-sm text-danger-fg">
                {(cancel.error instanceof ApiError && cancel.error.field && ERROR_TEXT[cancel.error.field]) ||
                  'Não foi possível cancelar.'}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!reason.trim() || cancel.isPending}
                className="h-10 flex-1 rounded-lg border border-danger-line bg-danger-soft px-3 text-[13px] font-medium text-danger-fg disabled:opacity-50"
              >
                Confirmar cancelamento
              </button>
              <button type="button" onClick={() => setReason(undefined)} className="h-10 px-2 text-[13px] text-muted">
                Voltar
              </button>
            </div>
          </form>
        ))}
    </li>
  );
}

/**
 * Sales paid in the open cash session (today's, without cash control), with "Cancelar venda": the stock comes back
 * and the payments are refunded by method in the open session.
 */
export function SaleHistory({ onClose }: { onClose: () => void }) {
  const sales = useFinalizedPosSales();
  const list = sales.data?.sales ?? [];

  return (
    <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vendas do caixa"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col bg-surface text-fg"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Vendas do caixa</p>
          <button type="button" onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
            Fechar
          </button>
        </div>
        {sales.isError && <p className="px-4 py-3 text-sm text-danger-fg">Não foi possível carregar as vendas.</p>}
        {sales.isSuccess && list.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nenhuma venda finalizada.</p>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {list.map((sale) => (
              <SaleRow key={sale.id} sale={sale} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
