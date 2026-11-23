import type { MoveMode, MoveStart } from '../../components/stock/stock-move';
import type { StockItem } from '../../lib/queries';
import type { StockFilter } from '../../lib/stock';

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { StockHistory } from '../../components/stock/stock-history';
import { isLowOrOut, StockItems } from '../../components/stock/stock-items';
import { StockMove } from '../../components/stock/stock-move';
import { useOperator } from '../../lib/operator';
import { useMe, useStockItems } from '../../lib/queries';
import { STOCK_FILTERS } from '../../lib/stock';
import { usePanelTheme } from '../../lib/theme';

type Screen = 'items' | 'history';

/**
 * `screen` absent = Movimentar. `item` (id or `new`) and `filter` keep the Itens view in the URL, with the same
 * names and types as the old `?sheet=stock` params (the panel's search reducers see every route's keys).
 */
type StockSearch = { screen?: Screen; item?: string; filter?: StockFilter };

export const Route = createFileRoute('/panel/$slug/stock')({
  validateSearch: (search: Record<string, unknown>): StockSearch => ({
    ...((search.screen === 'items' || search.screen === 'history') && { screen: search.screen }),
    ...(typeof search.item === 'string' && search.item && { item: search.item }),
    ...(STOCK_FILTERS.some(([value]) => value === search.filter) && { filter: search.filter as StockFilter })
  }),
  component: StockPage
});

const BUTTON = 'h-9 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover';

const VIEWS: [Screen | undefined, string][] = [
  [undefined, 'Movimentar'],
  ['items', 'Itens'],
  ['history', 'Histórico']
];

/**
 * Full-screen stock, scan first (outside the panel shell, like the POS).
 */
function StockPage() {
  usePanelTheme();
  const { slug } = Route.useParams();
  const { screen, item, filter = 'all' } = Route.useSearch();
  const navigate = Route.useNavigate();
  const store = useMe().data?.store;
  const { operator, lock } = useOperator();
  const items = useStockItems('all');
  const [start, setStart] = useState<MoveStart>();
  const alerts = (items.data?.items ?? []).filter(isLowOrOut).length;

  const go = (search: StockSearch) => void navigate({ search, replace: true });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-page text-fg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-4">
        <Link to="/panel/$slug" params={{ slug }} className={`${BUTTON} flex items-center`}>
          ← Painel
        </Link>
        <p className="hidden min-w-0 truncate text-sm font-semibold sm:block">
          Estoque {store && <span className="font-normal text-muted">· {store.name}</span>}
        </p>
        <nav className="grid grid-cols-3 rounded-lg bg-seg p-[3px]">
          {VIEWS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={screen === value}
              onClick={() => go(value ? { screen: value, ...(value === 'items' && { filter }) } : {})}
              className={`flex h-[30px] items-center justify-center gap-1.5 rounded-md px-3 text-[13px] ${
                screen === value ? 'bg-seg-on font-semibold text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted'
              }`}
            >
              {label}
              {value === 'items' && alerts > 0 && (
                <span className="rounded-full bg-warn-bg px-1.5 text-[11px] font-semibold text-warn-fg">{alerts}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        <span className="hidden text-xs text-faint xl:inline">
          F1 entrada · F2 perda · F3 contagem · F5 consultar · F10 lançar · Esc limpar
        </span>
        {operator && (
          <button type="button" onClick={lock} className={BUTTON}>
            <b className="font-semibold">{operator.name}</b>
            <span className="hidden sm:inline"> · Trocar</span>
          </button>
        )}
      </header>

      <StockMove
        hidden={screen !== undefined}
        start={start}
        onOpenItem={(itemId) => go({ screen: 'items', item: itemId })}
      />
      <StockItems
        hidden={screen !== 'items'}
        filter={filter}
        itemId={item}
        onFilter={(value) => go({ screen: 'items', ...(value !== 'all' && { filter: value }), ...(item && { item }) })}
        onItem={(itemId) =>
          go({ screen: 'items', ...(filter !== 'all' && { filter }), ...(itemId && { item: itemId }) })
        }
        onMove={(mode: MoveMode, target: StockItem) => {
          setStart({ mode, item: target, nonce: Date.now() });
          go({});
        }}
      />
      <StockHistory hidden={screen !== 'history'} />
    </div>
  );
}
