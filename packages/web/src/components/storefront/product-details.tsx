import type { CartLine } from '../../lib/cart';
import type { StorefrontProduct } from '../../lib/storefront';

import { useEffect, useState } from 'react';

import { optionsText, unitPrice } from '../../lib/cart';
import { formatMoney } from '../../lib/format';
import { isAvailable, startingPrice } from '../../lib/menu';
import { groupRule } from '../../lib/storefront';

/**
 * Details of a product: phone full screen, desktop modal. Closes on Esc or a click outside. With `onAdd` (the store
 * takes orders now) the options become choices, with quantity, notes and "Adicionar". `allowSoldOut` (staff, the POS)
 * lets sold-out products and options be chosen; `preselected` starts with those options chosen, `initialQty` with
 * that quantity.
 */
export function ProductDetails({
  product,
  onClose,
  onAdd,
  allowSoldOut = false,
  preselected = {},
  initialQty = 1
}: {
  product: StorefrontProduct;
  onClose: () => void;
  onAdd?: (line: Omit<CartLine, 'key'>) => void;
  allowSoldOut?: boolean;
  preselected?: Record<string, string[]>;
  initialQty?: number;
}) {
  const price = startingPrice(product);
  const [chosen, setChosen] = useState<Record<string, string[]>>(preselected);
  const choosable = (option: { active: boolean; sold_out?: boolean }) =>
    allowSoldOut ? option.active : isAvailable(option);
  const soldOut = product.sold_out && !allowSoldOut;
  const [qty, setQty] = useState(initialQty);
  const [notes, setNotes] = useState('');
  const short = product.groups.find((group) => (chosen[group.id]?.length ?? 0) < group.min);
  const unit = unitPrice(product, chosen);

  const toggle = (groupId: string, optionId: string, max: number) => {
    const current = chosen[groupId] ?? [];

    const next = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : max === 1
        ? [optionId]
        : current.length < max
          ? [...current, optionId]
          : current;

    setChosen({ ...chosen, [groupId]: next });
  };

  const add = () => {
    onAdd?.({
      product_id: product.id,
      name: product.name,
      options: optionsText(product, chosen),
      selections: Object.entries(chosen)
        .filter(([, ids]) => ids.length)
        .map(([group_id, option_ids]) => ({ group_id, option_ids })),
      notes: notes.trim() || null,
      qty,
      unit_cents: unit
    });
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const overflow = document.body.style.overflow;

    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-white md:flex md:items-center md:justify-center md:bg-neutral-900/55 md:p-10"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        onClick={(event) => event.stopPropagation()}
        className={`flex h-full w-full flex-col overflow-auto bg-white md:h-auto md:max-h-[720px] md:flex-row md:overflow-hidden md:rounded-2xl md:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ${
          product.image_url ? 'md:max-w-230' : 'md:max-w-xl'
        }`}
      >
        {product.image_url && (
          <img
            src={product.image_url}
            alt=""
            className="h-62.5 w-full shrink-0 bg-neutral-100 object-cover md:h-auto md:w-100"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
          <div className="flex items-start gap-4 border-b border-neutral-100 px-4 pb-4 pt-5 md:px-6">
            <div className="flex flex-1 flex-col gap-1.5">
              <h2 className="text-xl font-bold md:text-[22px]">{product.name}</h2>
              {product.description && <p className="text-sm leading-normal text-neutral-500">{product.description}</p>}
              <p className="text-[15px] font-semibold">
                {price.from ? `a partir de ${formatMoney(price.cents)}` : formatMoney(price.cents)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 pb-6 md:overflow-auto">
            {product.groups.map((group) => (
              <section key={group.id}>
                <div className="sticky top-0 flex items-center gap-3 bg-neutral-100 px-4 py-3 md:px-6">
                  <div className="flex flex-1 flex-col gap-0.5">
                    <h3 className="text-[15px] font-semibold">{group.name}</h3>
                    <p className="text-xs text-neutral-500">{groupRule(group)}</p>
                  </div>
                  {group.min > 0 && (
                    <span className="rounded-md bg-neutral-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white md:text-[11px]">
                      Obrigatório
                    </span>
                  )}
                </div>
                <ul>
                  {group.options.map((option) => (
                    <li
                      key={option.id}
                      role={onAdd && choosable(option) ? 'button' : undefined}
                      aria-pressed={
                        onAdd && choosable(option) ? (chosen[group.id]?.includes(option.id) ?? false) : undefined
                      }
                      onClick={onAdd && choosable(option) ? () => toggle(group.id, option.id, group.max) : undefined}
                      className={`flex min-h-14 items-center gap-3 border-b border-neutral-100 px-4 py-3 md:px-6 ${isAvailable(option) ? '' : 'opacity-45'} ${onAdd && choosable(option) ? 'cursor-pointer hover:bg-neutral-50' : ''}`}
                    >
                      {option.image_url && (
                        <img
                          src={option.image_url}
                          alt=""
                          loading="lazy"
                          className="size-12 shrink-0 rounded-lg bg-neutral-100 object-cover"
                        />
                      )}
                      <div className="flex flex-1 flex-col gap-0.5">
                        <span className="text-[15px] md:text-sm">{option.name}</span>
                        <span className="text-[13px] text-neutral-600">
                          {group.price_mode === 'max'
                            ? formatMoney(option.price_delta_cents)
                            : option.price_delta_cents
                              ? `+ ${formatMoney(option.price_delta_cents)}`
                              : ''}
                        </span>
                      </div>
                      {!isAvailable(option) && <span className="text-xs text-neutral-500">Esgotado</span>}
                      {onAdd && choosable(option) && (
                        <span
                          className={`flex size-5.5 shrink-0 items-center justify-center border-2 text-xs text-white ${group.max === 1 ? 'rounded-full' : 'rounded-md'} ${chosen[group.id]?.includes(option.id) ? 'border-accent bg-accent' : 'border-neutral-300'}`}
                        >
                          {chosen[group.id]?.includes(option.id) && '✓'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {onAdd && (
              <label className="block px-4 pt-4 text-sm font-medium md:px-6">
                Alguma observação?
                <textarea
                  value={notes}
                  maxLength={200}
                  rows={2}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ex.: sem cebola, bem passada"
                  className="mt-1.5 block w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm font-normal focus:border-accent focus:outline-none"
                />
              </label>
            )}
          </div>

          {onAdd && (
            <div className="flex shrink-0 items-center gap-3 border-t border-neutral-200 bg-white px-4 py-3 md:px-6">
              <div className="flex items-center rounded-lg border border-neutral-300">
                <button
                  type="button"
                  aria-label="Menos"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="size-10 text-lg text-neutral-600"
                >
                  −
                </button>
                <span className="w-7 text-center font-semibold">{qty}</span>
                <button
                  type="button"
                  aria-label="Mais"
                  onClick={() => setQty(Math.min(99, qty + 1))}
                  className="size-10 text-lg text-neutral-600"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                disabled={!!short || soldOut}
                onClick={add}
                className="h-11 flex-1 rounded-lg bg-accent px-4 text-[15px] font-semibold text-white disabled:opacity-50"
              >
                {soldOut ? 'Esgotado' : short ? `Escolha: ${short.name}` : `Adicionar · ${formatMoney(unit * qty)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
