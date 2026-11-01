import type { Discount, PosLinePatch, PosSale, PosSaleItem, PosSalePatch } from '../../lib/queries';

import { useEffect, useState } from 'react';

import { centsToInput, formatMoney, maskPhoneInput, parseMoney } from '../../lib/format';

const INPUT =
  'h-9 min-w-0 rounded-lg border border-line-2 bg-surface px-3 text-sm focus:border-accent focus:outline-none';

const BUTTON = 'h-9 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover disabled:opacity-50';

/**
 * Typed discount: empty clears it (null); undefined when it is not a valid value (cents ≥ 1, or percent 1–100).
 */
const parseDiscount = (kind: Discount['kind'], text: string): Discount | null | undefined => {
  if (!text.trim()) {
    return null;
  }

  const value = kind === 'value' ? parseMoney(text) : /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : undefined;

  if (!value || (kind === 'percent' && value > 100)) {
    return undefined;
  }

  return { kind, value };
};

const discountText = (discount: Discount | null) =>
  !discount ? '' : discount.kind === 'value' ? centsToInput(discount.value) : String(discount.value);

/**
 * Value (R$) or percent; saved when the field loses focus or the kind changes.
 */
function DiscountInput({
  discount,
  onChange
}: {
  discount: Discount | null;
  onChange: (discount: Discount | null | undefined) => void;
}) {
  const [kind, setKind] = useState<Discount['kind']>(discount?.kind ?? 'value');
  const [text, setText] = useState(discountText(discount));
  const commit = (nextKind: Discount['kind'], nextText: string) => {
    const next = parseDiscount(nextKind, nextText);

    if (JSON.stringify(next) !== JSON.stringify(discount)) {
      onChange(next);
    }
  };

  return (
    <span className="flex gap-1">
      <select
        value={kind}
        aria-label="Tipo de desconto"
        onChange={(event) => {
          const next = event.target.value as Discount['kind'];

          setKind(next);
          commit(next, text);
        }}
        className={`${INPUT} w-16 px-2`}
      >
        <option value="value">R$</option>
        <option value="percent">%</option>
      </select>
      <input
        value={text}
        inputMode="decimal"
        aria-label="Desconto"
        placeholder="0"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(kind, text)}
        className={`${INPUT} w-24`}
      />
    </span>
  );
}

/**
 * One line: quantity +/- (− at 1 removes it); tapping the name opens notes, discount and "Remover".
 */
function Line({
  item,
  disabled,
  onPatch,
  onRemove
}: {
  item: PosSaleItem;
  disabled: boolean;
  /**
   * undefined: the typed discount is invalid.
   */
  onPatch: (patch: PosLinePatch | undefined) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gross = item.unit_price_cents * item.qty;

  return (
    <li className="flex flex-col gap-2 border-b border-line px-3 py-2.5 md:px-4">
      <div className="flex items-start gap-2">
        <span className="flex shrink-0 items-center rounded-lg border border-line-2">
          <button
            type="button"
            aria-label="Menos"
            disabled={disabled}
            onClick={() => (item.qty > 1 ? onPatch({ qty: item.qty - 1 }) : onRemove())}
            className="size-8 text-fg-2 disabled:opacity-50"
          >
            −
          </button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{item.qty}</span>
          <button
            type="button"
            aria-label="Mais"
            disabled={disabled || item.qty >= 999}
            onClick={() => onPatch({ qty: item.qty + 1 })}
            className="size-8 text-fg-2 disabled:opacity-50"
          >
            +
          </button>
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-col text-left"
        >
          <span className="text-sm font-medium">{item.name}</span>
          {item.options && <span className="text-xs text-muted">{item.options}</span>}
          {item.notes && <span className="text-xs text-muted">Obs.: {item.notes}</span>}
        </button>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-sm font-semibold tabular-nums">{formatMoney(item.line_total_cents)}</span>
          {item.line_total_cents !== gross && (
            <span className="text-xs text-muted tabular-nums line-through">{formatMoney(gross)}</span>
          )}
        </span>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 pl-[86px]">
          <input
            key={item.notes}
            defaultValue={item.notes ?? ''}
            maxLength={200}
            placeholder="Observação do item"
            aria-label="Observação do item"
            onBlur={(event) => {
              const notes = event.target.value.trim() || null;

              if (notes !== item.notes) {
                onPatch({ notes });
              }
            }}
            className={`${INPUT} flex-1 basis-40`}
          />
          <DiscountInput
            key={JSON.stringify(item.discount)}
            discount={item.discount}
            onChange={(discount) => onPatch(discount === undefined ? undefined : { discount })}
          />
          <button type="button" disabled={disabled} onClick={onRemove} className={`${BUTTON} text-danger-fg`}>
            Remover
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Sale-wide fields: label, customer (name and/or WhatsApp), notes, discount and surcharge; each saved on blur.
 */
function SaleFields({ sale, onPatch }: { sale: PosSale; onPatch: (patch: PosSalePatch | undefined) => void }) {
  const [name, setName] = useState(sale.customer?.name ?? '');
  const [phone, setPhone] = useState(sale.customer?.phone ? maskPhoneInput(sale.customer.phone) : '');
  const commitCustomer = () => {
    const samePhone = phone === (sale.customer?.phone ? maskPhoneInput(sale.customer.phone) : '');

    if (name.trim() === (sale.customer?.name ?? '') && samePhone) {
      return;
    }

    onPatch({ customer: name.trim() || phone.trim() ? { name: name.trim() || null, phone: phone || null } : null });
  };

  return (
    <div className="grid grid-cols-2 gap-2 border-b border-line px-3 py-3 md:px-4">
      <input
        key={sale.label}
        defaultValue={sale.label ?? ''}
        maxLength={40}
        placeholder="Etiqueta (Maria, Mesa 4)"
        aria-label="Etiqueta da venda"
        onBlur={(event) => {
          const label = event.target.value.trim() || null;

          if (label !== sale.label) {
            onPatch({ label });
          }
        }}
        className={`${INPUT} col-span-2`}
      />
      <input
        value={name}
        maxLength={80}
        placeholder="Nome do cliente"
        aria-label="Nome do cliente"
        onChange={(event) => setName(event.target.value)}
        onBlur={commitCustomer}
        className={INPUT}
      />
      <input
        value={phone}
        inputMode="tel"
        placeholder="WhatsApp"
        aria-label="WhatsApp do cliente"
        onChange={(event) => setPhone(maskPhoneInput(event.target.value))}
        onBlur={commitCustomer}
        className={INPUT}
      />
      <textarea
        key={sale.notes}
        defaultValue={sale.notes ?? ''}
        maxLength={300}
        rows={2}
        placeholder="Observação da venda"
        aria-label="Observação da venda"
        onBlur={(event) => {
          const notes = event.target.value.trim() || null;

          if (notes !== sale.notes) {
            onPatch({ notes });
          }
        }}
        className={`${INPUT} col-span-2 h-auto resize-none py-2`}
      />
      <label className="flex flex-col gap-1 text-xs text-muted">
        Desconto na venda
        <DiscountInput
          key={JSON.stringify(sale.discount)}
          discount={sale.discount}
          onChange={(discount) => onPatch(discount === undefined ? undefined : { discount })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Acréscimo (R$)
        <input
          key={sale.surcharge_cents}
          defaultValue={sale.surcharge_cents ? centsToInput(sale.surcharge_cents) : ''}
          inputMode="decimal"
          placeholder="0,00"
          onBlur={(event) => {
            const text = event.target.value.trim();
            const cents = text ? parseMoney(text) : 0;

            if (cents === undefined) {
              onPatch(undefined);
            } else if (cents !== sale.surcharge_cents) {
              onPatch({ surcharge_cents: cents || null });
            }
          }}
          className={`${INPUT} w-full`}
        />
      </label>
    </div>
  );
}

/**
 * The current sale: lines, sale fields, totals from the server, and "Esperar", "Limpar", "Cobrar". `onBack` (phone)
 * returns to the products.
 */
export function SalePanel({
  sale,
  wide,
  disabled,
  onLinePatch,
  onRemove,
  onPatch,
  onHold,
  onClear,
  onCharge,
  onBack
}: {
  sale: PosSale | undefined;
  wide: boolean;
  disabled: boolean;
  onLinePatch: (item: PosSaleItem, patch: PosLinePatch | undefined) => void;
  onRemove: (item: PosSaleItem) => void;
  /**
   * undefined: the typed value is invalid.
   */
  onPatch: (patch: PosSalePatch | undefined) => void;
  onHold: () => void;
  onClear: () => void;
  onCharge: () => void;
  onBack: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const items = sale?.items ?? [];
  const count = items.reduce((total, { qty }) => total + qty, 0);

  // Armed for a few seconds; a change to the sale (or another sale) disarms it.
  useEffect(() => {
    if (!confirmClear) {
      return;
    }

    const timer = setTimeout(() => setConfirmClear(false), 4000);

    return () => clearTimeout(timer);
  }, [confirmClear]);

  useEffect(() => setConfirmClear(false), [sale?.id, sale?.total_cents]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 md:px-4">
        <button type="button" onClick={onBack} className={`${BUTTON} md:hidden`}>
          ← Produtos
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {sale?.label ?? 'Venda atual'}
          {count > 0 && <span className="font-normal text-muted"> · {count} itens</span>}
        </span>
        {sale && (
          <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className={BUTTON}>
            {details ? 'Fechar' : '+ Cliente, desconto'}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sale && details && <SaleFields key={sale.id} sale={sale} onPatch={onPatch} />}

        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Toque num produto ou bipe um código.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <Line
                key={item.item_id}
                item={item}
                disabled={disabled}
                onPatch={(patch) => onLinePatch(item, patch)}
                onRemove={() => onRemove(item)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-3 py-3 md:px-4">
        {sale && (sale.discount_cents > 0 || sale.surcharge_cents > 0 || sale.subtotal_cents !== sale.total_cents) && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-sm text-fg-2">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(sale.subtotal_cents)}</dd>
            {sale.discount_cents > 0 && (
              <>
                <dt>Desconto</dt>
                <dd className="tabular-nums">− {formatMoney(sale.discount_cents)}</dd>
              </>
            )}
            {sale.surcharge_cents > 0 && (
              <>
                <dt>Acréscimo</dt>
                <dd className="tabular-nums">+ {formatMoney(sale.surcharge_cents)}</dd>
              </>
            )}
          </dl>
        )}
        <p className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Total</span>
          <span className={`font-bold tabular-nums ${wide ? 'text-3xl' : 'text-2xl'}`}>
            {formatMoney(sale?.total_cents ?? 0)}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!sale || disabled} onClick={onHold} className={`${BUTTON} h-11`}>
            Esperar
          </button>
          <button
            type="button"
            disabled={!sale || disabled}
            onClick={() => {
              if (confirmClear) {
                setConfirmClear(false);
                onClear();
              } else {
                setConfirmClear(true);
              }
            }}
            className={`${BUTTON} h-11 ${confirmClear ? 'border-danger-line bg-danger-soft text-danger-fg' : ''}`}
          >
            {confirmClear ? 'Confirmar limpeza' : 'Limpar'}
          </button>
        </div>
        <button
          type="button"
          disabled={!items.length || disabled}
          onClick={onCharge}
          className="h-14 rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Cobrar {formatMoney(sale?.total_cents ?? 0)} <span className="text-sm font-normal opacity-80">F4</span>
        </button>
      </div>
    </div>
  );
}
