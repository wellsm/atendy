import type { StockItem, StockItemDetail, StockPackage } from '../../lib/queries';
import type { LossReason, StockUnit } from '../../lib/stock';

import { useCallback, useEffect, useRef, useState } from 'react';

import { BarcodeScanner } from './barcode-scanner';
import { ApiError, useApi } from '../../lib/api';
import { formatMoney, parseMoney } from '../../lib/format';
import { useOperator } from '../../lib/operator';
import { BARCODE, parseScan } from '../../lib/pos';
import {
  useCreateStockItem,
  useFindStockBarcode,
  useRecordStockCounts,
  useRecordStockEntries,
  useRecordStockLosses,
  useStockItems
} from '../../lib/queries';
import { BIG_UNIT, costPerBigUnitCents, costUnitLabel, formatQty, LOSS_REASONS, parseQty } from '../../lib/stock';

export type MoveMode = 'entry' | 'loss' | 'count' | 'lookup';

/**
 * An item to put in the batch from elsewhere (the item drawer); `nonce` makes each request a new one.
 */
export type MoveStart = { mode: MoveMode; item: StockItem; nonce: number };

const MODES: { id: MoveMode; label: string; hint: string; key: string; dot: string; text: string }[] = [
  { id: 'entry', label: 'Entrada', hint: 'Compra / recebimento', key: 'F1', dot: 'bg-on', text: 'text-ok-fg' },
  { id: 'loss', label: 'Saída', hint: 'Perda, quebra, consumo', key: 'F2', dot: 'bg-danger', text: 'text-danger-fg' },
  { id: 'count', label: 'Contagem', hint: 'Inventário / balanço', key: 'F3', dot: 'bg-out-fg', text: 'text-out-fg' },
  { id: 'lookup', label: 'Consultar', hint: 'Só ver saldo e ficha', key: 'F5', dot: 'bg-faint', text: 'text-fg' }
];

const KEYS: Record<string, MoveMode> = { F1: 'entry', F2: 'loss', F3: 'count', F5: 'lookup' };

const EMPTY_TEXT: Record<MoveMode, string> = {
  entry:
    'Bipe cada produto ou a caixa/fardo que chegou. Repetir o bipe soma; use 3*código para várias de uma vez. No fim, confira e lance tudo junto.',
  loss: 'Bipe o que foi perdido, quebrou ou venceu. Escolha o motivo ao lado e lance.',
  count: 'Bipe item por item na prateleira ou digite a quantidade contada. Ao lançar, o saldo vira o contado.',
  lookup: 'Bipe um código para ver saldo, mínimo, custo e a ficha do item, sem movimentar nada.'
};

const ERROR_TEXT: Record<string, string> = {
  item: 'Um item do lote não existe mais ou foi arquivado.',
  package: 'Uma embalagem do lote não existe mais.',
  qty: 'Quantidade inválida.',
  lines: 'O lote está vazio ou grande demais.',
  note: 'Explique o motivo.',
  total_cost: 'Custo inválido.'
};

const UNITS: [StockUnit, string][] = [
  ['un', 'Unidade (un)'],
  ['g', 'Peso (g / kg)'],
  ['ml', 'Volume (ml / L)']
];

type Line = {
  key: string;
  item: StockItem;
  packages: StockPackage[];
  /**
   * '' = the item's own unit (kg / L / un).
   */
  packageId: string;
  /**
   * Typed in the line's unit: packages, or kg / L / un.
   */
  qty: string;
  cost: string;
};

const INPUT = 'h-10 rounded-lg border border-line-2 bg-surface px-3 text-sm focus:border-accent focus:outline-none';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const parseNumber = (text: string) => {
  const value = text.trim().replace(',', '.');

  return /^\d+(\.\d{1,3})?$/.test(value) ? Number(value) : undefined;
};

const numberText = (value: number) => String(Math.round(value * 1000) / 1000).replace('.', ',');

const packOf = (line: Line) => line.packages.find(({ id }) => id === line.packageId);

/**
 * The line's quantity in the item's base unit (g, ml, un); undefined when not a whole base quantity.
 */
const baseOf = (line: Line) => {
  const value = parseNumber(line.qty);
  const pack = packOf(line);

  if (value === undefined) {
    return undefined;
  }

  const raw = pack ? value * pack.factor : BIG_UNIT[line.item.unit] ? value * 1000 : value;

  return Math.abs(raw - Math.round(raw)) < 1e-6 ? Math.round(raw) : undefined;
};

const afterOf = (mode: MoveMode, line: Line) => {
  const base = baseOf(line);

  if (base === undefined) {
    return undefined;
  }

  return mode === 'entry' ? line.item.balance + base : mode === 'loss' ? line.item.balance - base : base;
};

/**
 * One line per item and package: what the highlight and the scan merge key on.
 */
const lineId = (line: Pick<Line, 'item' | 'packageId'>) => `${line.item.id}:${line.packageId}`;

const lineUnit = (line: Line) => packOf(line)?.name.toLowerCase() ?? costUnitLabel(line.item.unit);

let lineSeq = 0;

/**
 * "Movimentar": scan into a batch for one mode (entry, loss, count) and post it whole, or look items up.
 */
export function StockMove({
  hidden,
  start,
  onOpenItem
}: {
  hidden: boolean;
  start: MoveStart | undefined;
  onOpenItem: (itemId: string) => void;
}) {
  const api = useApi();
  const { allows } = useOperator();
  const find = useFindStockBarcode();
  const items = useStockItems('all');
  const entries = useRecordStockEntries();
  const losses = useRecordStockLosses();
  const counts = useRecordStockCounts();
  const create = useCreateStockItem();
  const canMove = allows('stock_move');
  const canManage = allows('stock_manage');
  const [mode, setModeState] = useState<MoveMode>(canMove ? 'entry' : 'lookup');
  const [lines, setLines] = useState<Line[]>([]);
  const [lastKey, setLastKey] = useState<string>();
  const [last, setLast] = useState<{ item: StockItem; packageId?: string }>();
  const [scan, setScan] = useState('');
  const [message, setMessage] = useState<string>();
  const [unknown, setUnknown] = useState<string>();
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [reason, setReason] = useState<LossReason>('breakage');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string>();
  const scanRef = useRef<HTMLInputElement>(null);
  const packagesCache = useRef(new Map<string, StockPackage[]>());
  const saving = entries.isPending || losses.isPending || counts.isPending;

  const allowed = useCallback(
    (target: MoveMode) => target === 'lookup' || (target === 'count' ? canManage : canMove),
    [canMove, canManage]
  );

  const focus = () => setTimeout(() => scanRef.current?.focus(), 0);

  const setMode = useCallback(
    (next: MoveMode) => {
      if (!allowed(next)) {
        return;
      }

      if (next !== mode) {
        setLines([]);
        setLastKey(undefined);
      }

      setModeState(next);
      setMessage(undefined);
      setUnknown(undefined);
      focus();
    },
    [allowed, mode]
  );

  const packagesOf = useCallback(
    async (itemId: string) => {
      const cached = packagesCache.current.get(itemId);

      if (cached) {
        return cached;
      }

      const detail = await api<StockItemDetail>('GET', `/panel/stock/items/${itemId}`);

      packagesCache.current.set(itemId, detail.packages);

      return detail.packages;
    },
    [api]
  );

  /**
   * Adds `qty` (in the line's unit) of the item to the batch; a count line ignores packages and sums base amounts.
   */
  const addLine = useCallback(
    async (target: MoveMode, item: StockItem, pack: StockPackage | undefined, qty: number, initial?: string) => {
      const packages = await packagesOf(item.id);
      const packageId = target === 'count' ? '' : (pack?.id ?? '');
      const add = target === 'count' && pack ? (qty * pack.factor) / (BIG_UNIT[item.unit] ? 1000 : 1) : qty;

      const fresh = `l${++lineSeq}`;

      setLines((current) => {
        const existing = current.find((line) => line.item.id === item.id && line.packageId === packageId);

        return existing
          ? current.map((line) =>
              line.key === existing.key ? { ...line, qty: numberText((parseNumber(line.qty) ?? 0) + add) } : line
            )
          : [...current, { key: fresh, item, packages, packageId, qty: initial ?? numberText(add), cost: '' }];
      });
      setLastKey(`${item.id}:${packageId}`);
      setLast({ item, packageId: pack?.id });
    },
    [packagesOf]
  );

  /**
   * `addLine` for callers that do not wait for it: a failed item load becomes a message.
   */
  const addSafely = async (...args: Parameters<typeof addLine>) => {
    try {
      await addLine(...args);
    } catch {
      setMessage('Não foi possível carregar o item. Tente de novo.');
    }
  };

  const handleScan = async (text: string) => {
    const parsed = parseScan(text);

    setScan('');
    setMessage(undefined);
    setUnknown(undefined);

    if (!parsed) {
      return;
    }

    let item: StockItem | undefined;
    let pack: StockPackage | undefined;

    if (BARCODE.test(parsed.code)) {
      try {
        const found = await find(parsed.code);

        item = found.item;
        pack = found.package;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return setUnknown(parsed.code);
        }

        return setMessage('Não foi possível buscar o código. Tente de novo.');
      }
    } else {
      const search = normalize(parsed.code);

      item = items.data?.items.find(({ name, archived_at }) => !archived_at && normalize(name).includes(search));

      if (!item) {
        return setMessage(`Nenhum item com “${parsed.code}”.`);
      }
    }

    if (item.archived_at) {
      return setMessage(`${item.name} está arquivado.`);
    }

    try {
      if (mode === 'lookup') {
        await packagesOf(item.id);
        setLast({ item, packageId: pack?.id });
      } else {
        await addLine(mode, item, pack, parsed.qty);
      }
    } catch {
      setMessage('Não foi possível carregar o item. Tente de novo.');
    }
  };

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(undefined), 2600);
  };

  const calcs = lines.map((line) => ({ line, base: baseOf(line), after: afterOf(mode, line) }));
  const bad = calcs.find(({ base }) => base === undefined || (mode !== 'count' && base <= 0));
  const needsNote = mode === 'loss' && reason === 'other' && !note.trim();
  const negative = mode === 'loss' ? calcs.find(({ after }) => after !== undefined && after < 0) : undefined;
  const badCost = mode === 'entry' && lines.some((line) => line.cost.trim() && parseMoney(line.cost) === undefined);
  const invalid = bad
    ? `Quantidade inválida em ${bad.line.item.name}.`
    : badCost
      ? 'Custo inválido em algum item.'
      : needsNote
        ? 'Explique o motivo em “Outro”.'
        : negative
          ? `${negative.line.item.name} ficará negativo.`
          : undefined;
  const blocked = !lines.length || !!bad || badCost || needsNote || mode === 'lookup' || saving;
  const costTotal = lines.reduce((sum, line) => sum + (parseMoney(line.cost) ?? 0), 0);
  const modeInfo = MODES.find(({ id }) => id === mode)!;

  const done = () => {
    flash(`${modeInfo.label} lançada · ${lines.length} ${lines.length === 1 ? 'item' : 'itens'}`);
    setLines([]);
    setLastKey(undefined);
    setSupplier('');
    setInvoice('');
    setNote('');
    focus();
  };

  const failed = (error: Error) =>
    setMessage(
      error instanceof ApiError && error.field
        ? (ERROR_TEXT[error.field] ?? 'Não foi possível lançar. Tente de novo.')
        : 'Não foi possível lançar. Tente de novo.'
    );

  const commit = () => {
    if (blocked) {
      return;
    }

    setMessage(undefined);

    // A whole number of packages goes as packages (the API multiplies); anything else as base units.
    const packed = calcs.map(({ line, base }) => {
      const pack = packOf(line);
      const value = parseNumber(line.qty)!;

      return pack && Number.isInteger(value)
        ? { item_id: line.item.id, package_id: pack.id, qty: value }
        : { item_id: line.item.id, qty: base! };
    });

    if (mode === 'entry') {
      entries.mutate(
        {
          lines: packed.map((row, index) => {
            const cost = parseMoney(lines[index]!.cost);

            return cost === undefined ? row : { ...row, total_cost_cents: cost };
          }),
          ...(supplier.trim() && { supplier: supplier.trim() }),
          ...(invoice.trim() && { invoice: invoice.trim() })
        },
        { onSuccess: done, onError: failed }
      );
    } else if (mode === 'loss') {
      losses.mutate(
        { lines: packed, reason, ...(note.trim() && { note: note.trim() }) },
        { onSuccess: done, onError: failed }
      );
    } else if (mode === 'count') {
      counts.mutate(
        calcs.map(({ line, base }) => ({ item_id: line.item.id, counted: base! })),
        { onSuccess: done, onError: failed }
      );
    }
  };

  const commitRef = useRef(commit);

  commitRef.current = commit;

  useEffect(() => {
    if (hidden) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      const target = KEYS[event.key];

      if (target) {
        event.preventDefault();
        setMode(target);
      } else if (event.key === 'F10') {
        event.preventDefault();
        commitRef.current();
      } else if (event.key === 'Escape') {
        setScan('');
        setMessage(undefined);
        setUnknown(undefined);
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [hidden, setMode]);

  useEffect(() => {
    if (!start || !allowed(start.mode)) {
      return;
    }

    setModeState(start.mode);
    setLines([]);
    setMessage(undefined);
    setUnknown(undefined);

    // A count starts from the current balance: launching it unchanged writes nothing.
    const initial =
      start.mode === 'count' ? numberText(start.item.balance / (BIG_UNIT[start.item.unit] ? 1000 : 1)) : undefined;

    void addSafely(start.mode, start.item, undefined, start.mode === 'count' ? 0 : 1, initial);
    focus();
    // Only a new request (nonce) starts a batch.
  }, [start?.nonce]);

  const patchLine = (target: Line, patch: Partial<Line>) => {
    setLastKey(lineId({ ...target, ...patch }));
    setLines((current) => current.map((line) => (line.key === target.key ? { ...line, ...patch } : line)));
  };

  const step = (line: Line, delta: number) =>
    patchLine(line, { qty: numberText(Math.max(0, (parseNumber(line.qty) ?? 0) + delta)) });

  return (
    <div className={`min-h-0 flex-1 flex-col lg:flex-row ${hidden ? 'hidden' : 'flex'}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={!allowed(option.id)}
              aria-pressed={mode === option.id}
              onClick={() => setMode(option.id)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left disabled:opacity-40 ${
                mode === option.id ? 'border-accent bg-surface' : 'border-line bg-hover hover:bg-surface'
              }`}
            >
              <span className="flex w-full items-center gap-2 text-sm font-semibold">
                <span className={`h-2 w-2 rounded-full ${option.dot}`} />
                <span className="flex-1">{option.label}</span>
                <span className="hidden rounded border border-line-2 px-1 text-[10px] font-medium text-muted md:inline">
                  {option.key}
                </span>
              </span>
              <span className="text-xs text-muted">{option.hint}</span>
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleScan(scan);
          }}
          className="flex gap-2"
        >
          <input
            ref={scanRef}
            autoFocus
            value={scan}
            onChange={(event) => setScan(event.target.value)}
            autoComplete="off"
            aria-label="Código de barras ou nome"
            placeholder={
              mode === 'lookup'
                ? 'Bipe para consultar…'
                : `Bipe ou digite o código · ${modeInfo.label.toLowerCase()} (3*código = 3)`
            }
            className="h-12 min-w-0 flex-1 rounded-xl border-2 border-line-2 bg-surface px-4 text-base focus:border-accent focus:outline-none"
          />
          <BarcodeScanner onCode={(code) => void handleScan(code)} />
        </form>

        {message && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{message}</p>}

        {unknown && (
          <UnknownCode
            code={unknown}
            canCreate={canManage}
            saving={create.isPending}
            onCreate={(input) =>
              create.mutate(
                { ...input, barcode: unknown, packages: [] },
                {
                  onSuccess: ({ item }) => {
                    setUnknown(undefined);
                    packagesCache.current.set(item.id, []);

                    if (mode === 'lookup') {
                      setLast({ item });
                    } else {
                      void addSafely(mode, item, undefined, 1);
                    }

                    focus();
                  },
                  onError: () => setMessage('Não foi possível cadastrar. Confira o nome e tente de novo.')
                }
              )
            }
            onCancel={() => {
              setUnknown(undefined);
              focus();
            }}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="hidden grid-cols-[130px_minmax(0,1.5fr)_190px_150px_170px_28px] gap-3 border-b border-line bg-hover px-4 py-2 text-xs text-muted md:grid">
            <span>Código</span>
            <span>Item</span>
            <span>{mode === 'count' ? 'Contado' : 'Quantidade'}</span>
            <span>{mode === 'entry' ? 'Custo total' : mode === 'count' ? 'Diferença' : 'Sai do estoque'}</span>
            <span>Saldo</span>
            <span />
          </div>
          <div className="flex-1 overflow-y-auto">
            {!lines.length && (
              <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
                <span className="font-semibold">
                  {mode === 'lookup' ? 'Modo consulta' : `Lote de ${modeInfo.label.toLowerCase()} vazio`}
                </span>
                <span className="max-w-md text-sm text-muted">{EMPTY_TEXT[mode]}</span>
              </div>
            )}
            {calcs.map(({ line, base, after }) => {
              const pack = packOf(line);
              const diff = after === undefined ? undefined : after - line.item.balance;

              return (
                <div
                  key={line.key}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 md:grid-cols-[130px_minmax(0,1.5fr)_190px_150px_170px_28px] ${
                    lastKey === lineId(line) ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span className="hidden truncate font-mono text-xs text-muted md:block">
                    {pack?.barcode ?? line.item.barcode ?? '—'}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium">{line.item.name}</span>
                    {mode !== 'count' && line.packages.length > 0 && (
                      <select
                        value={line.packageId}
                        onChange={(event) => patchLine(line, { packageId: event.target.value })}
                        aria-label="Embalagem"
                        className="h-8 max-w-full self-start rounded-md border border-line-2 bg-surface px-2 text-xs"
                      >
                        <option value="">Unidade base ({costUnitLabel(line.item.unit)})</option>
                        {line.packages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} = {formatQty(option.factor, line.item.unit)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 md:col-span-1">
                    <span className="flex items-center rounded-lg border border-line-2">
                      <button
                        type="button"
                        aria-label="Menos"
                        onClick={() => step(line, -1)}
                        className="h-9 w-8 text-fg-2"
                      >
                        −
                      </button>
                      <input
                        value={line.qty}
                        onChange={(event) => patchLine(line, { qty: event.target.value })}
                        inputMode="decimal"
                        aria-label="Quantidade"
                        className={`h-9 w-16 border-x bg-surface text-center text-sm tabular-nums focus:outline-none ${
                          base === undefined ? 'border-danger text-danger-fg' : 'border-line-2'
                        }`}
                      />
                      <button
                        type="button"
                        aria-label="Mais"
                        onClick={() => step(line, 1)}
                        className="h-9 w-8 text-fg-2"
                      >
                        +
                      </button>
                    </span>
                    <span className="truncate text-xs text-muted">{lineUnit(line)}</span>
                  </div>
                  <div className="col-span-2 text-sm md:col-span-1">
                    {mode === 'entry' && (
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-muted">R$</span>
                        <input
                          value={line.cost}
                          onChange={(event) => patchLine(line, { cost: event.target.value })}
                          inputMode="decimal"
                          placeholder="Custo total"
                          aria-label="Custo total"
                          className="h-9 w-28 rounded-lg border border-line-2 bg-surface px-2 text-sm focus:border-accent focus:outline-none"
                        />
                      </span>
                    )}
                    {mode === 'count' && diff !== undefined && (
                      <span className={diff > 0 ? 'text-ok-fg' : diff < 0 ? 'text-danger-fg' : 'text-muted'}>
                        {diff > 0 ? '+' : ''}
                        {formatQty(diff, line.item.unit)}
                      </span>
                    )}
                    {mode === 'loss' && (
                      <span className="text-muted">
                        {base === undefined ? '—' : `− ${formatQty(base, line.item.unit)}`}
                      </span>
                    )}
                  </div>
                  <span className="text-sm tabular-nums">
                    {formatQty(line.item.balance, line.item.unit)} →{' '}
                    <b className={after !== undefined && after < 0 ? 'text-danger-fg' : modeInfo.text}>
                      {after === undefined ? '—' : formatQty(after, line.item.unit)}
                    </b>
                  </span>
                  <button
                    type="button"
                    aria-label="Remover"
                    onClick={() => setLines((current) => current.filter(({ key }) => key !== line.key))}
                    className="justify-self-end text-faint hover:text-danger-fg"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="flex shrink-0 flex-col border-t border-line bg-surface lg:w-80 lg:border-t-0 lg:border-l">
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">
            {mode === 'lookup' ? 'Item consultado' : 'Último bipado'}
          </span>
          {last ? (
            <LastScanned
              mode={mode}
              item={last.item}
              pack={packagesCache.current.get(last.item.id)?.find(({ id }) => id === last.packageId)}
              after={mode === 'lookup' ? undefined : calcs.find(({ line }) => line.item.id === last.item.id)?.after}
              onOpen={() => onOpenItem(last.item.id)}
            />
          ) : (
            <p className="text-sm text-muted">Bipe um código para ver o item aqui.</p>
          )}

          {mode === 'entry' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">
                Dados da compra <span className="font-normal text-muted">(opcional)</span>
              </span>
              <input
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="Fornecedor"
                maxLength={80}
                className={INPUT}
              />
              <input
                value={invoice}
                onChange={(event) => setInvoice(event.target.value)}
                placeholder="Nº da nota fiscal"
                maxLength={40}
                className={INPUT}
              />
            </div>
          )}

          {mode === 'loss' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Motivo da saída</span>
              <div className="grid grid-cols-2 gap-1.5">
                {LOSS_REASONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={reason === value}
                    onClick={() => setReason(value)}
                    className={`h-9 rounded-lg border text-[13px] ${
                      reason === value
                        ? 'border-danger bg-danger-soft font-medium text-danger-fg'
                        : 'border-line-2 text-fg-2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                placeholder={reason === 'other' ? 'Explique o que aconteceu' : 'Observação (opcional)'}
                className={INPUT}
              />
            </div>
          )}

          {mode === 'count' && (
            <p className="rounded-lg bg-out-bg px-3 py-2 text-sm text-out-fg">
              Cada bipe soma 1 ao contado. Ao lançar, o saldo de cada item vira exatamente o valor contado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted">
              {lines.length} {lines.length === 1 ? 'item' : 'itens'} no lote
            </span>
            {mode === 'entry' && (
              <span>
                Custo <b>{formatMoney(costTotal)}</b>
              </span>
            )}
          </div>
          {invalid && lines.length > 0 && (
            <span
              className={`text-sm ${negative && !bad && !needsNote && !badCost ? 'text-warn-fg' : 'text-danger-fg'}`}
            >
              {invalid}
            </span>
          )}
          <button
            type="button"
            disabled={blocked}
            onClick={commit}
            className={`flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white disabled:opacity-45 ${
              mode === 'loss'
                ? 'bg-danger'
                : mode === 'count'
                  ? 'bg-out-fg'
                  : mode === 'lookup'
                    ? 'bg-faint'
                    : 'bg-accent'
            }`}
          >
            {mode === 'lookup'
              ? 'Consulta não movimenta'
              : saving
                ? 'Lançando…'
                : `Lançar ${modeInfo.label.toLowerCase()}`}
            <span className="hidden rounded border border-white/40 px-1 text-[10px] md:inline">F10</span>
          </button>
          <button
            type="button"
            disabled={!lines.length}
            onClick={() => {
              setLines([]);
              setLastKey(undefined);
              focus();
            }}
            className="h-9 rounded-lg text-sm text-fg-2 hover:bg-hover disabled:opacity-50"
          >
            Limpar lote
          </button>
        </div>
      </aside>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-fg px-4 py-2.5 text-sm font-medium text-surface shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function LastScanned({
  mode,
  item,
  pack,
  after,
  onOpen
}: {
  mode: MoveMode;
  item: StockItem;
  pack: StockPackage | undefined;
  after: number | undefined;
  onOpen: () => void;
}) {
  const badge = item.balance <= 0 ? 'Esgotado' : item.low ? 'Baixo' : undefined;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-semibold">{item.name}</span>
        {badge && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              item.balance <= 0 ? 'bg-danger-soft text-danger-fg' : 'bg-warn-bg text-warn-fg'
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      <span className="font-mono text-xs text-muted">{pack?.barcode ?? item.barcode ?? 'sem código'}</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-hover p-2">
          <span className="block text-xs text-muted">Saldo atual</span>
          <span className="text-lg font-bold tabular-nums">{formatQty(item.balance, item.unit)}</span>
        </div>
        <div className="rounded-lg bg-hover p-2">
          <span className="block text-xs text-muted">
            {mode === 'lookup' || after === undefined ? 'Estoque mínimo' : 'Depois do lote'}
          </span>
          <span className="text-lg font-bold tabular-nums">
            {mode === 'lookup' || after === undefined
              ? item.min_qty == null
                ? '—'
                : formatQty(item.min_qty, item.unit)
              : formatQty(after, item.unit)}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Estoque mínimo</dt>
        <dd className="text-right">{item.min_qty == null ? '—' : formatQty(item.min_qty, item.unit)}</dd>
        <dt className="text-muted">Custo médio</dt>
        <dd className="text-right">
          {item.avg_cost_millicents > 0
            ? `${formatMoney(costPerBigUnitCents(item.avg_cost_millicents, item.unit))} / ${costUnitLabel(item.unit)}`
            : '—'}
        </dd>
        {pack && (
          <>
            <dt className="text-muted">Código lido</dt>
            <dd className="text-right">
              {pack.name} ({formatQty(pack.factor, item.unit)})
            </dd>
          </>
        )}
      </dl>
      <button type="button" onClick={onOpen} className="self-start text-sm font-medium text-accent-fg">
        Ver ficha do item →
      </button>
    </div>
  );
}

/**
 * A scanned code no item has: register it on the spot (managers) and it joins the batch.
 */
function UnknownCode({
  code,
  canCreate,
  saving,
  onCreate,
  onCancel
}: {
  code: string;
  canCreate: boolean;
  saving: boolean;
  onCreate: (input: { name: string; unit: StockUnit; min_qty: number | null }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockUnit>('un');
  const [min, setMin] = useState('');
  const minQty = min.trim() ? parseQty(min, unit, true) : null;
  const cant = !name.trim() || minQty === undefined || saving;

  const save = () => {
    if (!cant) {
      onCreate({ name: name.trim(), unit, min_qty: minQty });
    }
  };

  if (!canCreate) {
    return (
      <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-fg">
        Código {code} não cadastrado. Peça a um gerente para cadastrar o item.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm">
      <span className="text-warn-fg">
        <b>Código {code} não cadastrado.</b> Cadastre agora e ele entra no lote.
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-fg-2">
          Nome
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
            maxLength={80}
            placeholder="Ex.: Água mineral 500 ml"
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-2">
          Medido em
          <select value={unit} onChange={(event) => setUnit(event.target.value as StockUnit)} className={INPUT}>
            {UNITS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-36 flex-col gap-1 text-xs font-medium text-fg-2">
          Estoque mínimo ({costUnitLabel(unit)})
          <input
            value={min}
            onChange={(event) => setMin(event.target.value)}
            inputMode="decimal"
            placeholder="Opcional"
            className={INPUT}
          />
        </label>
        <button
          type="button"
          disabled={cant}
          onClick={save}
          className="h-10 rounded-lg bg-accent px-4 font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Cadastrando…' : 'Cadastrar e adicionar'}
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-lg px-3 text-fg-2 hover:bg-surface">
          Ignorar
        </button>
      </div>
    </div>
  );
}
