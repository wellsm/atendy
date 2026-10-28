import type { PosHeldSale } from '../../lib/queries';

import { formatMoney, formatWhen } from '../../lib/format';

/**
 * Sales on hold (server drafts, so they survive a reload and show on other devices); picking one makes it current.
 */
export function HeldSales({
  sales,
  onPick,
  onClose
}: {
  sales: PosHeldSale[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 flex justify-end bg-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vendas em espera"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col bg-surface text-fg"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Vendas em espera</p>
          <button type="button" onClick={onClose} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-2">
            Fechar
          </button>
        </div>
        {sales.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nenhuma venda em espera.</p>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {sales.map((sale) => (
              <li key={sale.id}>
                <button
                  type="button"
                  onClick={() => onPick(sale.id)}
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left hover:bg-hover"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{sale.label ?? 'Sem etiqueta'}</span>
                    <span className="text-xs text-muted">
                      {sale.items_count} itens · {formatWhen(sale.created_at)}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(sale.total_cents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
