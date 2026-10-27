import type { FormEvent } from 'react';
import type { StockItem } from '../../lib/queries';
import type { MovementKind } from '../stock/movement-form';

import { useState } from 'react';

import { Sheet, SheetHeader } from './sheet';
import { ApiError } from '../../lib/api';
import { formatMoney, formatWhen } from '../../lib/format';
import { usePanelNavigate, usePanelSearch } from '../../lib/panel-search';
import { useFindStockBarcode, useStockItem, useStockItems, useStockSummary } from '../../lib/queries';
import {
  costPerBigUnitCents,
  costUnitLabel,
  formatQty,
  LOSS_REASONS,
  MOVEMENT_LABELS,
  STOCK_FILTERS
} from '../../lib/stock';
import { Loading } from '../loading';
import { BarcodeScanner } from '../stock/barcode-scanner';
import { ItemForm } from '../stock/item-form';
import { MovementForm, movementTitle } from '../stock/movement-form';
import { INPUT } from '../stock/qty-input';

type Action = { kind: MovementKind; item: StockItem; packageId?: string };

const BUTTON = 'h-9 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const isBarcode = (text: string) => /^\d{8,14}$/.test(text.trim());

function Badge({ item }: { item: StockItem }) {
  const text = item.archived_at ? 'Arquivado' : item.balance <= 0 ? 'Esgotado' : item.low ? 'Baixo' : undefined;

  if (!text) {
    return null;
  }

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        item.archived_at ? 'bg-canceled-bg text-canceled-fg' : 'bg-placed-bg text-placed-fg'
      }`}
    >
      {text}
    </span>
  );
}

function ActionButtons({ item, onAction }: { item: StockItem; onAction: (action: Action) => void }) {
  if (item.archived_at) {
    return null;
  }

  return (
    <div className="flex gap-1.5">
      <button type="button" className={BUTTON} onClick={() => onAction({ kind: 'entry', item })}>
        Entrada
      </button>
      <button type="button" className={BUTTON} onClick={() => onAction({ kind: 'loss', item })}>
        Perda
      </button>
      <button type="button" className={BUTTON} onClick={() => onAction({ kind: 'count', item })}>
        Contagem
      </button>
    </div>
  );
}

/**
 * The stock list (`?sheet=stock`, `&filter=`), an item with its history (`&item=<id>`) or the new item form
 * (`&item=new`). Entry / loss / count forms replace the content until saved.
 */
export function StockSheet({ onClose }: { onClose: () => void }) {
  const navigate = usePanelNavigate();
  const { item: itemId } = usePanelSearch();
  const [action, setAction] = useState<Action>();
  const [newBarcode, setNewBarcode] = useState<string>();

  const back = () => {
    setAction(undefined);
    setNewBarcode(undefined);
    void navigate({ sheet: 'stock' });
  };

  return (
    <Sheet width="md" label="Estoque" onClose={onClose}>
      {action ? (
        <>
          <SheetHeader title={movementTitle(action.kind)} onBack={() => setAction(undefined)} onClose={onClose} />
          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
            <MovementForm
              kind={action.kind}
              item={action.item}
              packageId={action.packageId}
              onDone={() => setAction(undefined)}
              onCancel={() => setAction(undefined)}
            />
          </div>
        </>
      ) : itemId === 'new' ? (
        <>
          <SheetHeader title="Novo item" onBack={back} onClose={onClose} />
          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
            <ItemForm
              initialBarcode={newBarcode}
              onDone={(id) => void navigate({ sheet: 'stock', item: id })}
              onCancel={back}
            />
          </div>
        </>
      ) : itemId ? (
        <ItemView key={itemId} itemId={itemId} onAction={setAction} onClose={onClose} />
      ) : (
        <StockList onAction={setAction} onClose={onClose} onNewWithBarcode={setNewBarcode} />
      )}
    </Sheet>
  );
}

function StockList({
  onAction,
  onClose,
  onNewWithBarcode
}: {
  onAction: (action: Action) => void;
  onClose: () => void;
  onNewWithBarcode: (code: string) => void;
}) {
  const navigate = usePanelNavigate();
  const { filter = 'all' } = usePanelSearch();
  const items = useStockItems(filter);
  const summary = useStockSummary();
  const find = useFindStockBarcode();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string>();
  const [unknownCode, setUnknownCode] = useState<string>();

  const search = normalize(query);
  const visible = (items.data?.items ?? []).filter(
    ({ name, barcode }) => !search || normalize(name).includes(search) || (barcode ?? '').includes(search)
  );

  const lookup = async (code: string) => {
    setMessage(undefined);
    setUnknownCode(undefined);

    try {
      const { item, package: pack } = await find(code);

      setQuery('');

      if (pack) {
        onAction({ kind: 'entry', item, packageId: pack.id });
      } else {
        void navigate({ sheet: 'stock', item: item.id });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setUnknownCode(code);
      } else {
        setMessage('Não foi possível buscar o código. Tente novamente.');
      }
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (isBarcode(query)) {
      void lookup(query.trim());
    }
  };

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${active ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`;

  return (
    <>
      <SheetHeader
        title="Estoque"
        subtitle={summary.data ? `${summary.data.low} baixos · ${summary.data.sold_out} esgotados` : undefined}
        onClose={onClose}
      >
        <button
          type="button"
          onClick={() => {
            onNewWithBarcode('');
            void navigate({ sheet: 'stock', item: 'new' });
          }}
          className="flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-red-700"
        >
          + Item
        </button>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-8 pt-4 md:px-6">
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            aria-label="Buscar por nome ou código de barras"
            placeholder="Buscar por nome ou código de barras"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <BarcodeScanner
            onCode={(code) => {
              setQuery(code);
              void lookup(code);
            }}
          />
        </form>

        {message && <p className="text-sm text-accent-fg">{message}</p>}

        {unknownCode && (
          <p className="rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
            Nenhum item com o código {unknownCode}.{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                onNewWithBarcode(unknownCode);
                void navigate({ sheet: 'stock', item: 'new' });
              }}
            >
              Cadastrar item
            </button>
          </p>
        )}

        <div className="flex gap-2 overflow-x-auto">
          {STOCK_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => void navigate({ sheet: 'stock', ...(value !== 'all' && { filter: value }) })}
              className={chip(filter === value)}
            >
              {label}
            </button>
          ))}
        </div>

        {items.isPending && <Loading />}
        {items.isError && <p className="text-sm text-accent-fg">Não foi possível carregar o estoque.</p>}
        {items.data && visible.length === 0 && (
          <p className="text-sm text-muted">
            {items.data.items.length === 0 ? 'Nenhum item aqui ainda.' : 'Nada encontrado para essa busca.'}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void navigate({ sheet: 'stock', item: item.id })}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                >
                  {item.name}
                </button>
                <Badge item={item} />
                <span className="text-sm font-semibold tabular-nums">{formatQty(item.balance, item.unit)}</span>
              </div>
              <ActionButtons item={item} onAction={onAction} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ItemView({
  itemId,
  onAction,
  onClose
}: {
  itemId: string;
  onAction: (action: Action) => void;
  onClose: () => void;
}) {
  const navigate = usePanelNavigate();
  const query = useStockItem(itemId);
  const [editing, setEditing] = useState(false);
  const back = () => void navigate({ sheet: 'stock' });
  const first = query.data?.pages[0]?.detail;
  const movements = query.data?.pages.flatMap((page) => page.movements) ?? [];

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <>
      <SheetHeader title={first?.item.name ?? 'Item de estoque'} onBack={back} onClose={onClose} />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
        {query.isPending && <Loading />}
        {notFound && <p className="text-sm text-muted">Item não encontrado.</p>}
        {query.isError && !notFound && <p className="text-sm text-accent-fg">Não foi possível carregar o item.</p>}

        {first && editing && (
          <ItemForm
            item={first.item}
            packages={first.packages}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        )}

        {first && !editing && (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold tabular-nums">{formatQty(first.item.balance, first.item.unit)}</p>
                <Badge item={first.item} />
                <button type="button" onClick={() => setEditing(true)} className={`${BUTTON} ml-auto`}>
                  Editar
                </button>
              </div>
              <ActionButtons item={first.item} onAction={onAction} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Código de barras</dt>
                <dd>{first.item.barcode ?? '—'}</dd>
                <dt className="text-muted">Estoque mínimo</dt>
                <dd>{first.item.min_qty == null ? '—' : formatQty(first.item.min_qty, first.item.unit)}</dd>
                <dt className="text-muted">Custo médio</dt>
                <dd>
                  {first.item.avg_cost_millicents > 0
                    ? `${formatMoney(costPerBigUnitCents(first.item.avg_cost_millicents, first.item.unit))} / ${costUnitLabel(first.item.unit)}`
                    : '—'}
                </dd>
              </dl>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Embalagens</h3>
              {first.packages.length === 0 && <p className="text-sm text-muted">Nenhuma embalagem cadastrada.</p>}
              {first.packages.map((pack) => (
                <p key={pack.id} className="text-sm">
                  {pack.name} · {formatQty(pack.factor, first.item.unit)}
                  {pack.barcode && <span className="text-muted"> · {pack.barcode}</span>}
                </p>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Usado em</h3>
              {first.links.length === 0 && (
                <p className="text-sm text-muted">
                  Nenhum produto usa este item. Vincule no formulário do produto, no cardápio.
                </p>
              )}
              {first.links.map((link) => (
                <p key={`${link.product_id}-${link.option_id}`} className="text-sm">
                  {link.name} <span className="text-muted">· {link.option_id ? 'opção' : 'produto'}</span> ·{' '}
                  {formatQty(link.qty, first.item.unit)}
                </p>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Histórico</h3>
              {movements.length === 0 && <p className="text-sm text-muted">Sem movimentações.</p>}
              <ul className="flex flex-col divide-y divide-line">
                {movements.map((movement) => (
                  <li key={movement.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col">
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
                    </div>
                    <span className={`tabular-nums ${movement.qty_delta < 0 ? 'text-accent-fg' : 'text-on'}`}>
                      {movement.qty_delta > 0 ? '+' : ''}
                      {formatQty(movement.qty_delta, first.item.unit)}
                    </span>
                    <span className="w-20 text-right text-xs tabular-nums text-muted">
                      {formatQty(movement.balance_after, first.item.unit)}
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
          </>
        )}
      </div>
    </>
  );
}
