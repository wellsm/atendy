import type { FormEvent } from 'react';
import type { StockItem } from '../../lib/queries';
import type { LossReason } from '../../lib/stock';

import { useState } from 'react';

import { INPUT, QtyInput } from './qty-input';
import { ApiError } from '../../lib/api';
import { parseMoney } from '../../lib/format';
import { useRecordStockCount, useRecordStockEntry, useRecordStockLoss, useStockItem } from '../../lib/queries';
import { formatQty, LOSS_REASONS } from '../../lib/stock';

export type MovementKind = 'entry' | 'loss' | 'count';

const FIELD_ERRORS: Record<string, string> = {
  qty: 'Informe uma quantidade válida.',
  reason: 'Escolha o motivo.',
  note: 'Explique o que aconteceu.',
  item: 'Item não encontrado.',
  package: 'Embalagem não encontrada.'
};

const errorText = (error: unknown) =>
  error instanceof ApiError && error.status === 400
    ? ((error.field && FIELD_ERRORS[error.field]) ?? 'Revise os campos.')
    : 'Não foi possível salvar. Tente novamente.';

const TITLES: Record<MovementKind, string> = {
  entry: 'Entrada de estoque',
  loss: 'Registrar perda',
  count: 'Contagem de estoque'
};

/**
 * Entry (purchase), loss or count for one item. `packageId` presets an entry to the package a barcode matched.
 */
export function MovementForm({
  kind,
  item,
  packageId,
  onDone,
  onCancel
}: {
  kind: MovementKind;
  item: StockItem;
  packageId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const detail = useStockItem(kind === 'entry' ? item.id : undefined);
  const packages = detail.data?.pages[0]?.detail?.packages ?? [];
  const entry = useRecordStockEntry();
  const loss = useRecordStockLoss();
  const count = useRecordStockCount();
  const [pack, setPack] = useState(packageId ?? '');
  const [qty, setQty] = useState<number>();
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState<LossReason>('breakage');
  const [note, setNote] = useState('');
  const mutation = { entry, loss, count }[kind];
  const costCents = cost.trim() ? parseMoney(cost) : undefined;
  const selectedPack = packages.find(({ id }) => id === pack);
  // A package preset must resolve before anything is sent, or "5 fardos" would be recorded as 5 base units.
  const presetPending = !!packageId && !selectedPack;
  const presetFailed = presetPending && (detail.isError || detail.isSuccess);
  const valid =
    !presetPending &&
    qty !== undefined &&
    (kind === 'count' || qty > 0) &&
    (kind !== 'entry' || !cost.trim() || costCents !== undefined) &&
    (kind !== 'loss' || reason !== 'other' || note.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (qty === undefined || presetPending) {
      return;
    }

    const options = { onSuccess: onDone };

    if (kind === 'entry') {
      entry.mutate(
        {
          item_id: item.id,
          ...(selectedPack && { package_id: selectedPack.id }),
          qty,
          ...(costCents !== undefined && { total_cost_cents: costCents })
        },
        options
      );
    } else if (kind === 'loss') {
      loss.mutate({ item_id: item.id, qty, reason, ...(note.trim() && { note: note.trim() }) }, options);
    } else {
      count.mutate({ item_id: item.id, counted: qty }, options);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {item.name} · saldo atual {formatQty(item.balance, item.unit)}
      </p>

      {presetPending && !presetFailed && <p className="text-sm text-muted">Carregando embalagem…</p>}

      {presetFailed && (
        <p className="text-sm text-accent-fg">
          Não foi possível carregar a embalagem do código lido. Volte e tente de novo.
        </p>
      )}

      {kind === 'entry' && packages.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Quantidade em
          <select
            value={pack}
            onChange={(event) => {
              setPack(event.target.value);
              setQty(undefined);
            }}
            className={INPUT}
          >
            <option value="">{item.unit}</option>
            {packages.map(({ id, name, factor }) => (
              <option key={id} value={id}>
                {name} ({formatQty(factor, item.unit)})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-1.5 text-sm font-medium">
        {kind === 'count' ? 'Quantidade contada' : selectedPack ? 'Quantas embalagens' : 'Quantidade'}
        <QtyInput
          key={`${kind}-${pack}`}
          unit={selectedPack ? 'un' : item.unit}
          onChange={setQty}
          label="Quantidade"
          disabled={presetPending}
        />
        {kind === 'count' && (
          <span className="text-xs font-normal text-muted">O saldo vira exatamente esse valor.</span>
        )}
      </div>

      {kind === 'entry' && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Custo total da compra em R$ (opcional)
          <input
            inputMode="decimal"
            placeholder="0,00"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className={INPUT}
          />
          <span className="text-xs font-normal text-muted">Usado para calcular o custo médio.</span>
        </label>
      )}

      {kind === 'loss' && (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Motivo
            <select value={reason} onChange={(event) => setReason(event.target.value as LossReason)} className={INPUT}>
              {LOSS_REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Observação{reason === 'other' ? '' : ' (opcional)'}
            <input value={note} onChange={(event) => setNote(event.target.value)} className={INPUT} />
          </label>
        </>
      )}

      {mutation.error && <p className="text-sm text-accent-fg">{errorText(mutation.error)}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={mutation.isPending || !valid}
          className="h-10 rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {mutation.isPending ? 'Salvando…' : TITLES[kind]}
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-lg px-4 text-sm text-fg-2 hover:bg-hover">
          Cancelar
        </button>
      </div>
    </form>
  );
}

export const movementTitle = (kind: MovementKind) => TITLES[kind];
