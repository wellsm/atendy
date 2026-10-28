import type { RefObject } from 'react';
import type { PosMenuProduct } from '../../lib/queries';

import { useEffect } from 'react';

import { priceLabel } from '../../lib/menu';
import { BARCODE, parseScan } from '../../lib/pos';
import { searchable } from '../../lib/storefront';
import { BarcodeScanner } from '../stock/barcode-scanner';

const SUGGESTIONS = 6;

/**
 * Products whose name has the typed text (accent- and case-insensitive); none for a barcode.
 */
export const matchProducts = (products: PosMenuProduct[], text: string) => {
  const code = parseScan(text)?.code;

  if (!code || BARCODE.test(code)) {
    return [];
  }

  const wanted = searchable(code);

  return products.filter(({ name }) => searchable(name).includes(wanted));
};

/**
 * The always-present search/barcode field: a USB reader types the code and Enter; `3*<code>` is quantity 3. Enter
 * sends the text to `onSubmit` (barcode or first match); a suggestion click picks that product.
 */
export function SearchBar({
  inputRef,
  query,
  onQuery,
  products,
  big,
  disabled,
  onSubmit,
  onPick
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  products: PosMenuProduct[];
  big: boolean;
  disabled: boolean;
  onSubmit: (text: string) => void;
  onPick: (product: PosMenuProduct, qty: number) => void;
}) {
  const suggestions = matchProducts(products, query).slice(0, SUGGESTIONS);
  const qty = parseScan(query)?.qty ?? 1;

  // Focused for the USB reader, but not on phones (the keyboard would cover the grid).
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      inputRef.current?.focus();
    }
  }, [inputRef]);

  return (
    <div className="relative flex shrink-0 gap-2 p-3 md:px-4">
      <form
        className="flex min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();

          if (query.trim()) {
            onSubmit(query);
            onQuery('');
          }
        }}
      >
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={big ? 'Bipe ou digite… (qtd*código: 3*7891234)' : 'Buscar ou bipar código…'}
          aria-label="Buscar produto ou código de barras"
          inputMode="search"
          autoComplete="off"
          className={`min-w-0 flex-1 rounded-lg border border-line-2 bg-surface px-3 focus:border-accent focus:outline-none disabled:opacity-60 ${big ? 'h-14 text-lg' : 'h-11 text-sm'}`}
        />
      </form>
      {!disabled && (
        <span className={`flex items-center ${big ? '[&>button]:h-14' : '[&>button]:h-11'}`}>
          <BarcodeScanner onCode={onSubmit} />
        </span>
      )}

      {suggestions.length > 0 && (
        <ul className="absolute inset-x-3 top-full z-30 -mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-lg md:inset-x-4">
          {suggestions.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(product, qty);
                  onQuery('');
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{product.name}</span>
                {product.sold_out && <span className="text-xs text-muted">Esgotado</span>}
                <span className="tabular-nums text-fg-2">{priceLabel(product)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
