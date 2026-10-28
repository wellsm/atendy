import type { PosMenuCategory, PosMenuProduct } from '../../lib/queries';

import { useState } from 'react';

import { priceLabel } from '../../lib/menu';
import { initials } from '../../lib/storefront';

const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${active ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`;

/**
 * Category chips and product cards (photo, price, "Esgotado"); a sold-out product can still be sold at the counter.
 */
export function ProductGrid({
  categories,
  onPick
}: {
  categories: PosMenuCategory[];
  onPick: (product: PosMenuProduct) => void;
}) {
  const [categoryId, setCategoryId] = useState<string>();
  const shown = categories.filter(({ id }) => !categoryId || id === categoryId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-2 overflow-x-auto px-3 pb-3 md:px-4">
        <button type="button" onClick={() => setCategoryId(undefined)} className={chip(!categoryId)}>
          Todos
        </button>
        {categories.map(({ id, name }) => (
          <button key={id} type="button" onClick={() => setCategoryId(id)} className={chip(categoryId === id)}>
            {name}
          </button>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-24 sm:grid-cols-3 md:px-4 md:pb-4 lg:grid-cols-4 2xl:grid-cols-5">
        {shown.flatMap(({ products }) =>
          products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onPick(product)}
              className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left hover:bg-hover active:scale-[0.98]"
            >
              {product.image_url ? (
                <img src={product.image_url} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              ) : (
                <span className="flex aspect-[4/3] w-full items-center justify-center bg-surface-2 text-xl font-semibold text-faint">
                  {initials(product.name)}
                </span>
              )}
              <span className="flex flex-1 flex-col gap-0.5 p-2.5">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</span>
                <span className="mt-auto flex items-center gap-1.5 text-[13px]">
                  <span className="font-semibold tabular-nums">{priceLabel(product)}</span>
                  {product.sold_out && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                      Esgotado
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
