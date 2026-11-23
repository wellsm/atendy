import type { ReactNode } from 'react';
import type { MoveMode } from './stock-move';
import type { StockItem } from '../../lib/queries';
import type { StockFilter } from '../../lib/stock';

import { useState } from 'react';

import { ItemForm } from './item-form';
import { ApiError } from '../../lib/api';
import { formatMoney, formatWhen } from '../../lib/format';
import { useOperator } from '../../lib/operator';
import { useStockItem, useStockItems } from '../../lib/queries';
import { costPerBigUnitCents, costUnitLabel, formatQty, LOSS_REASONS, MOVEMENT_LABELS } from '../../lib/stock';
import { Loading } from '../loading';

const UNIT_LABEL: Record<StockItem['unit'], string> = { un: 'Unidade', g: 'Peso', ml: 'Volume' };

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Sold out, below the minimum (with balance) or archived; undefined when fine.
 */
const badgeOf = (item: StockItem) =>
  item.archived_at
    ? { text: 'Arquivado', className: 'bg-surface-2 text-muted' }
    : item.balance <= 0
      ? { text: 'Esgotado', className: 'bg-danger-soft text-danger-fg' }
      : item.low
        ? { text: 'Baixo', className: 'bg-warn-bg text-warn-fg' }
        : undefined;

export const isLowOrOut = (item: StockItem) => !item.archived_at && (item.balance <= 0 || item.low);

const averageCost = (item: StockItem) =>
  item.avg_cost_millicents > 0
    ? `${formatMoney(costPerBigUnitCents(item.avg_cost_millicents, item.unit))} / ${costUnitLabel(item.unit)}`
    : '—';

function Badge({ item }: { item: StockItem }) {
  const badge = badgeOf(item);

  return badge ? (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.text}</span>
  ) : (
    <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-semibold text-ok-fg">OK</span>
  );
}

/**
 * "Itens": summary cards that filter, search, the table and the item drawer (`item` = id or `new`).
 */
export function StockItems({
  hidden,
  filter,
  itemId,
  onFilter,
  onItem,
  onMove
}: {
  hidden: boolean;
  filter: StockFilter;
  itemId: string | undefined;
  onFilter: (filter: StockFilter) => void;
  onItem: (itemId: string | undefined) => void;
  onMove: (mode: MoveMode, item: StockItem) => void;
}) {
  const manage = useOperator().allows('stock_manage');
  const active = useStockItems('all');
  const archived = useStockItems('archived');
  const [query, setQuery] = useState('');

  const activeItems = (active.data?.items ?? []).filter(({ archived_at }) => !archived_at);
  const lists: Record<StockFilter, StockItem[]> = {
    all: activeItems,
    low: activeItems.filter((item) => item.balance > 0 && item.low),
    sold_out: activeItems.filter((item) => item.balance <= 0),
    archived: archived.data?.items ?? []
  };
  const cards: [StockFilter, string, string][] = [
    ['all', 'Itens ativos', 'text-fg'],
    ['low', 'Abaixo do mínimo', 'text-warn-fg'],
    ['sold_out', 'Esgotados', 'text-danger-fg'],
    ['archived', 'Arquivados', 'text-muted']
  ];
  const search = normalize(query);
  const rows = lists[filter].filter(
    ({ name, barcode }) => !search || normalize(name).includes(search) || (barcode ?? '').includes(search)
  );
  const loading = active.isPending || (filter === 'archived' && archived.isPending);

  return (
    <div className={`min-h-0 flex-1 ${hidden ? 'hidden' : 'flex'}`}>
      <div className={`min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5 ${itemId ? 'hidden md:flex' : 'flex'}`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {cards.map(([value, label, tone]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border-2 bg-surface px-4 py-3 text-left ${
                filter === value ? 'border-accent' : 'border-line hover:border-line-2'
              }`}
            >
              <span className="text-xs text-muted">{label}</span>
              <span className={`text-2xl font-bold ${lists[value].length ? tone : 'text-fg'}`}>
                {lists[value].length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome ou código"
            aria-label="Buscar item"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-2 bg-surface px-3 text-sm focus:border-accent focus:outline-none md:max-w-sm"
          />
          {manage && (
            <button
              type="button"
              onClick={() => onItem('new')}
              className="ml-auto h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
            >
              + Item
            </button>
          )}
        </div>

        {loading && <Loading />}
        {active.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o estoque.</p>}

        {!loading && (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_140px_110px_100px_120px_100px] gap-3 border-b border-line bg-hover px-4 py-2 text-xs text-muted md:grid">
              <span>Item</span>
              <span>Código</span>
              <span>Saldo</span>
              <span>Mínimo</span>
              <span>Custo médio</span>
              <span>Situação</span>
            </div>
            {!rows.length && (
              <p className="px-4 py-6 text-sm text-muted">
                {lists[filter].length ? 'Nada encontrado para essa busca.' : 'Nenhum item aqui.'}
              </p>
            )}
            <ul className="divide-y divide-line">
              {rows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onItem(item.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm md:grid-cols-[minmax(0,1.6fr)_140px_110px_100px_120px_100px] ${
                      itemId === item.id ? 'bg-accent-soft' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className={`truncate font-medium ${item.archived_at ? 'text-muted' : ''}`}>
                        {item.name}
                      </span>
                      <span className="text-xs text-muted">{UNIT_LABEL[item.unit]}</span>
                    </span>
                    <span className="hidden truncate font-mono text-xs text-muted md:block">{item.barcode ?? '—'}</span>
                    <span className={`tabular-nums ${item.balance <= 0 ? 'text-danger-fg' : ''}`}>
                      {formatQty(item.balance, item.unit)}
                    </span>
                    <span className="hidden text-muted md:block">
                      {item.min_qty == null ? '—' : formatQty(item.min_qty, item.unit)}
                    </span>
                    <span className="hidden text-muted md:block">{averageCost(item)}</span>
                    <span className="hidden md:block">
                      <Badge item={item} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {itemId && (
        <aside className="flex w-full flex-col border-line bg-surface md:w-[420px] md:shrink-0 md:border-l">
          {itemId === 'new' ? (
            <>
              <DrawerHeader title="Novo item" onClose={() => onItem(undefined)} />
              <div className="flex-1 overflow-y-auto p-5">
                {manage ? (
                  <ItemForm onDone={(id) => onItem(id)} onCancel={() => onItem(undefined)} />
                ) : (
                  <p className="text-sm text-muted">Só um gerente cadastra itens.</p>
                )}
              </div>
            </>
          ) : (
            <ItemDrawer key={itemId} itemId={itemId} onClose={() => onItem(undefined)} onMove={onMove} />
          )}
        </aside>
      )}
    </div>
  );
}

function DrawerHeader({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
      <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="h-8 w-8 rounded-lg text-muted hover:bg-hover"
      >
        ✕
      </button>
    </div>
  );
}

const BUTTON = 'h-9 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover';

function ItemDrawer({
  itemId,
  onClose,
  onMove
}: {
  itemId: string;
  onClose: () => void;
  onMove: (mode: MoveMode, item: StockItem) => void;
}) {
  const { allows } = useOperator();
  const query = useStockItem(itemId);
  const [editing, setEditing] = useState(false);
  const first = query.data?.pages[0]?.detail;
  const movements = query.data?.pages.flatMap((page) => page.movements) ?? [];
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const manage = allows('stock_manage');

  if (!first) {
    return (
      <>
        <DrawerHeader title="Item de estoque" onClose={onClose} />
        <div className="p-5">
          {query.isPending && <Loading />}
          {notFound && <p className="text-sm text-muted">Item não encontrado.</p>}
          {query.isError && !notFound && <p className="text-sm text-danger-fg">Não foi possível carregar o item.</p>}
        </div>
      </>
    );
  }

  const { item, packages, links } = first;

  if (editing && manage) {
    return (
      <>
        <DrawerHeader title="Editar item" onClose={onClose} />
        <div className="flex-1 overflow-y-auto p-5">
          <ItemForm
            item={item}
            packages={packages}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <DrawerHeader title={item.name} onClose={onClose}>
        {manage && (
          <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
            Editar
          </button>
        )}
      </DrawerHeader>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold tabular-nums">{formatQty(item.balance, item.unit)}</span>
          {badgeOf(item) && <Badge item={item} />}
        </div>

        {!item.archived_at && (
          <div className="flex flex-wrap gap-1.5">
            {allows('stock_move') && (
              <>
                <button type="button" onClick={() => onMove('entry', item)} className={BUTTON}>
                  + Entrada
                </button>
                <button type="button" onClick={() => onMove('loss', item)} className={BUTTON}>
                  − Saída
                </button>
              </>
            )}
            {manage && (
              <button type="button" onClick={() => onMove('count', item)} className={BUTTON}>
                Contagem
              </button>
            )}
          </div>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Código de barras</dt>
          <dd className="text-right font-mono text-xs">{item.barcode ?? '—'}</dd>
          <dt className="text-muted">Medido em</dt>
          <dd className="text-right">{UNIT_LABEL[item.unit]}</dd>
          <dt className="text-muted">Estoque mínimo</dt>
          <dd className="text-right">{item.min_qty == null ? '—' : formatQty(item.min_qty, item.unit)}</dd>
          <dt className="text-muted">Custo médio</dt>
          <dd className="text-right">{averageCost(item)}</dd>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Embalagens de compra</h3>
          {!packages.length && <p className="text-sm text-muted">Nenhuma embalagem cadastrada.</p>}
          {packages.map((pack) => (
            <p key={pack.id} className="flex justify-between gap-3 text-sm">
              <span>
                {pack.name} · {formatQty(pack.factor, item.unit)}
              </span>
              {pack.barcode && <span className="font-mono text-xs text-muted">{pack.barcode}</span>}
            </p>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Usado em</h3>
          {!links.length && (
            <p className="text-sm text-muted">Nenhum produto usa este item. Vincule no formulário do produto.</p>
          )}
          {links.map((link) => (
            <p key={`${link.product_id}-${link.option_id}`} className="text-sm">
              {link.name} <span className="text-muted">· {formatQty(link.qty, item.unit)}</span>
            </p>
          ))}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Histórico</h3>
          {!movements.length && <p className="text-sm text-muted">Sem movimentações.</p>}
          <ul className="flex flex-col divide-y divide-line">
            {movements.map((movement) => (
              <li key={movement.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">
                    {MOVEMENT_LABELS[movement.kind] ?? 'Movimento'}
                    {movement.reason && (
                      <span className="font-normal text-muted">
                        {' · '}
                        {LOSS_REASONS.find(([value]) => value === movement.reason)?.[1] ?? movement.reason}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {formatWhen(movement.created_at)}
                    {movement.note && ` · ${movement.note}`}
                  </span>
                </span>
                <span className={`tabular-nums ${movement.qty_delta < 0 ? 'text-danger-fg' : 'text-ok-fg'}`}>
                  {movement.qty_delta > 0 ? '+' : ''}
                  {formatQty(movement.qty_delta, item.unit)}
                </span>
                <span className="w-20 text-right text-xs tabular-nums text-muted">
                  {formatQty(movement.balance_after, item.unit)}
                </span>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className={`${BUTTON} self-start disabled:opacity-50`}
            >
              {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </section>
      </div>
    </>
  );
}
