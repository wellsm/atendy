import type { StockItem, StockLinkDraft } from '../../lib/queries';

import { useState } from 'react';

import { BarcodeScanner } from './barcode-scanner';
import { ItemForm } from './item-form';
import { INPUT, QtyInput } from './qty-input';
import { useFindStockBarcode, useStockItems } from '../../lib/queries';

const MAX_RESULTS = 6;

const toDraft = (item: StockItem): StockLinkDraft => ({
  stock_item_id: item.id,
  name: item.name,
  unit: item.unit,
  qty: 0
});

/**
 * The stock items a product or option consumes per unit sold. A link with `qty` 0 is still being typed (the form
 * blocks the save until every quantity is filled). `createName` offers creating a new item named like the product.
 */
export function StockLinksEditor({
  links,
  onChange,
  createName
}: {
  links: StockLinkDraft[];
  onChange: (links: StockLinkDraft[]) => void;
  createName: string;
}) {
  const items = useStockItems('all');
  const findBarcode = useFindStockBarcode();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const linked = new Set(links.map(({ stock_item_id }) => stock_item_id));
  const text = search.trim().toLowerCase();

  const results = text
    ? (items.data?.items ?? [])
        .filter(({ id, name, archived_at }) => !archived_at && !linked.has(id) && name.toLowerCase().includes(text))
        .slice(0, MAX_RESULTS)
    : [];

  const add = (item: StockItem) => {
    if (!linked.has(item.id)) {
      onChange([...links, toDraft(item)]);
    }

    setSearch('');
    setNotFound(false);
  };

  const scan = async (code: string) => {
    setNotFound(false);

    try {
      add((await findBarcode(code)).item);
    } catch {
      setNotFound(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <li key={link.stock_item_id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 basis-40 truncate text-sm">{link.name}</span>
              <div className="w-44">
                <QtyInput
                  unit={link.unit}
                  initial={link.qty || null}
                  label={`Quantidade de ${link.name} por unidade`}
                  placeholder="por unidade"
                  onChange={(qty) =>
                    onChange(
                      links.map((current) =>
                        current.stock_item_id === link.stock_item_id ? { ...current, qty: qty ?? 0 } : current
                      )
                    )
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(links.filter(({ stock_item_id }) => stock_item_id !== link.stock_item_id))}
                className="rounded px-2 py-1 text-muted hover:bg-surface-2"
                aria-label={`Remover ${link.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <ItemForm
            initialName={createName}
            onCancel={() => setCreating(false)}
            onDone={(_id, item) => {
              setCreating(false);

              if (item) {
                add(item);
              }
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return;
                }

                // A USB scanner types the code and presses Enter: never submit the product form from here.
                event.preventDefault();

                const code = search.trim();

                if (/^\d{6,}$/.test(code)) {
                  void scan(code);
                } else if (results[0]) {
                  add(results[0]);
                }
              }}
              placeholder="Buscar item do estoque"
              aria-label="Buscar item do estoque"
              className={`${INPUT} min-w-0 flex-1`}
            />
            <BarcodeScanner onCode={scan} />
          </div>

          {results.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => add(item)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
                  >
                    {item.name}
                    <span className="text-xs text-muted">{item.unit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {text && !results.length && items.data && (
            <p className="text-sm text-muted">Nenhum item encontrado com esse nome.</p>
          )}
          {notFound && <p className="text-sm text-warn-fg">Nenhum item com esse código de barras.</p>}

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="self-start text-sm font-medium text-accent-fg"
          >
            Criar item a partir deste produto
          </button>
        </>
      )}
    </div>
  );
}
