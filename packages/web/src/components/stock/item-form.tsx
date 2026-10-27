import type { FormEvent } from 'react';
import type { StockItem, StockItemInput, StockPackage } from '../../lib/queries';
import type { StockUnit } from '../../lib/stock';

import { useState } from 'react';

import { BarcodeScanner } from './barcode-scanner';
import { INPUT, QtyInput } from './qty-input';
import { ApiError } from '../../lib/api';
import { useArchiveStockItem, useCreateStockItem, useUpdateStockItem } from '../../lib/queries';

const UNITS: [StockUnit, string][] = [
  ['un', 'Unidade (un)'],
  ['g', 'Peso (g / kg)'],
  ['ml', 'Volume (ml / L)']
];

const FIELD_ERRORS: Record<string, string> = {
  name: 'O nome precisa ter de 1 a 80 caracteres.',
  unit: 'Escolha a unidade.',
  min_qty: 'O estoque mínimo precisa ser um número válido.',
  barcode: 'Esse código de barras já está em outro item.',
  packages: 'Revise as embalagens: nome, quantidade e código.'
};

const errorText = (error: unknown) =>
  error instanceof ApiError && error.status === 400
    ? ((error.field && FIELD_ERRORS[error.field]) ?? 'Revise os campos.')
    : 'Não foi possível salvar. Tente novamente.';

type PackageDraft = { key: string; id?: string; name: string; factor?: number; barcode: string };

let packageKey = 0;

const draftOf = (pack?: StockPackage): PackageDraft => ({
  key: `p${++packageKey}`,
  ...(pack && { id: pack.id }),
  name: pack?.name ?? '',
  factor: pack?.factor,
  barcode: pack?.barcode ?? ''
});

/**
 * Create (`item` absent) or edit a stock item with its purchase packages. The unit of an item cannot change
 * once it exists, so the factors keep meaning the same.
 */
export function ItemForm({
  item,
  packages,
  initialBarcode,
  initialName,
  onDone,
  onCancel
}: {
  item?: StockItem;
  packages?: StockPackage[];
  initialBarcode?: string;
  initialName?: string;
  onDone: (id: string, item?: StockItem) => void;
  onCancel: () => void;
}) {
  const create = useCreateStockItem();
  const update = useUpdateStockItem();
  const archive = useArchiveStockItem();
  const [name, setName] = useState(item?.name ?? initialName ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'un');
  const [barcode, setBarcode] = useState(item?.barcode ?? initialBarcode ?? '');
  const [minQty, setMinQty] = useState<number | undefined>(item?.min_qty ?? undefined);
  const [drafts, setDrafts] = useState<PackageDraft[]>(() => (packages ?? []).map(draftOf));
  const [confirmArchive, setConfirmArchive] = useState(false);
  const saving = create.isPending || update.isPending;
  const valid = name.trim() && drafts.every((draft) => draft.name.trim() && draft.factor && draft.factor > 0);

  const patchDraft = (key: string, patch: Partial<PackageDraft>) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const input: StockItemInput = {
      name: name.trim(),
      unit,
      barcode: barcode.trim() || null,
      min_qty: minQty ?? null,
      packages: drafts.map((draft) => ({
        ...(draft.id && { id: draft.id }),
        name: draft.name.trim(),
        factor: draft.factor!,
        barcode: draft.barcode.trim() || null
      }))
    };

    if (item) {
      update.mutate({ id: item.id, input }, { onSuccess: ({ item: saved }) => onDone(saved.id) });
    } else {
      create.mutate(input, { onSuccess: ({ item: saved }) => onDone(saved.id, saved) });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nome
        <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Medido em
        <select
          value={unit}
          disabled={!!item}
          onChange={(event) => setUnit(event.target.value as StockUnit)}
          className={INPUT}
        >
          {UNITS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5 text-sm font-medium">
        Código de barras (opcional)
        <div className="flex gap-2">
          <input
            aria-label="Código de barras"
            inputMode="numeric"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <BarcodeScanner onCode={setBarcode} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-sm font-medium">
        Estoque mínimo (opcional)
        <QtyInput key={unit} unit={unit} initial={minQty} onChange={setMinQty} label="Estoque mínimo" />
        <span className="text-xs font-normal text-muted">Abaixo disso o item aparece como baixo.</span>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Embalagens de compra</p>
        {drafts.map((draft) => (
          <div key={draft.key} className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <input
              aria-label="Nome da embalagem"
              placeholder="Ex.: Caixa com 12"
              value={draft.name}
              onChange={(event) => patchDraft(draft.key, { name: event.target.value })}
              className={INPUT}
            />
            <div className="flex flex-col gap-1 text-xs text-muted">
              Quanto vem em cada embalagem
              <QtyInput
                key={unit}
                unit={unit}
                initial={draft.factor}
                onChange={(factor) => patchDraft(draft.key, { factor })}
                label="Quantidade por embalagem"
              />
            </div>
            <div className="flex gap-2">
              <input
                aria-label="Código de barras da embalagem"
                placeholder="Código de barras (opcional)"
                inputMode="numeric"
                value={draft.barcode}
                onChange={(event) => patchDraft(draft.key, { barcode: event.target.value })}
                className={`${INPUT} min-w-0 flex-1`}
              />
              <BarcodeScanner onCode={(code) => patchDraft(draft.key, { barcode: code })} />
              <button
                type="button"
                onClick={() => setDrafts((current) => current.filter(({ key }) => key !== draft.key))}
                className="h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDrafts((current) => [...current, draftOf()])}
          className="h-9 self-start rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover"
        >
          + Embalagem
        </button>
      </div>

      {(create.error || update.error) && (
        <p className="text-sm text-accent-fg">{errorText(create.error ?? update.error)}</p>
      )}
      {archive.error && <p className="text-sm text-accent-fg">Não foi possível arquivar. Tente novamente.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !valid}
          className="h-10 rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-lg px-4 text-sm text-fg-2 hover:bg-hover">
          Cancelar
        </button>
        {item && !item.archived_at && (
          <button
            type="button"
            disabled={archive.isPending}
            onClick={() => {
              if (!confirmArchive) {
                return setConfirmArchive(true);
              }

              archive.mutate(item.id, { onSuccess: onCancel });
            }}
            className="ml-auto h-10 rounded-lg px-4 text-sm text-accent-fg hover:bg-accent-soft"
          >
            {confirmArchive ? 'Confirmar arquivamento' : 'Arquivar'}
          </button>
        )}
      </div>
    </form>
  );
}
