import type { StockUnit } from '../../lib/stock';

import { useState } from 'react';

import { BIG_UNIT, parseQty, qtyToInput } from '../../lib/stock';

export const INPUT =
  'rounded-md border border-line-2 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none';

/**
 * A quantity field: typed in the base unit, or in kg / L for g / ml items. Reports the base-unit integer, or
 * `undefined` while the text is empty or invalid. `initial` is read once.
 */
export function QtyInput({
  unit,
  initial,
  onChange,
  label,
  placeholder,
  disabled
}: {
  unit: StockUnit;
  initial?: number | null;
  onChange: (qty: number | undefined) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState(() => (initial == null ? { text: '', inBig: false } : qtyToInput(initial, unit)));
  const big = BIG_UNIT[unit];
  const inBig = !!big && state.inBig;

  const update = (next: { text: string; inBig: boolean }) => {
    setState(next);
    onChange(parseQty(next.text, unit, next.inBig));
  };

  return (
    <div className="flex gap-2">
      <input
        aria-label={label}
        inputMode="decimal"
        value={state.text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => update({ ...state, text: event.target.value })}
        className={`${INPUT} min-w-0 flex-1`}
      />
      {big ? (
        <select
          aria-label="Unidade"
          value={inBig ? big : unit}
          onChange={(event) => update({ ...state, inBig: event.target.value === big })}
          className={INPUT}
        >
          <option value={unit}>{unit}</option>
          <option value={big}>{big}</option>
        </select>
      ) : (
        <span className="flex items-center text-sm text-muted">{unit}</span>
      )}
    </div>
  );
}
