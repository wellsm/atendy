import type { ReactNode } from 'react';
import type { ImageChange, MenuGroup, PriceMode, ProductInput } from '../../lib/queries';

import { centsToInput, parseMoney } from '../../lib/format';
import { Toggle } from '../toggle';
import { OptionPhoto } from './option-photo';

export const INPUT =
  'rounded-md border border-line-2 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:bg-hover';

export const MAX_NAME = 80;

const MAX_OPTIONS = 100;

const MAX_PRICE_CENTS = 10_000_000;

export type OptionForm = {
  key: string;
  id?: string;
  name: string;
  price: string;
  active: boolean;
  /**
   * `active` when the form opened; the save sends `active` only when it changed (see `ProductInput`).
   */
  loadedActive?: boolean;
  /**
   * Shown photo: the saved one, or a local preview of a picked file.
   */
  imageUrl: string | null;
  /**
   * The option had a saved photo when the form opened (removing it must reach the API).
   */
  hadImage?: boolean;
  imageChange?: ImageChange;
};

export type GroupForm = {
  key: string;
  id?: string;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: OptionForm[];
};

export const newKey = () => crypto.randomUUID();

/**
 * Empty money field means zero.
 */
export const money = (text: string) => (text.trim() ? parseMoney(text) : 0);

export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const toOptionForm = (option: MenuGroup['options'][number], keepId: boolean): OptionForm => ({
  key: newKey(),
  ...(keepId && { id: option.id }),
  name: option.name,
  price: option.price_delta_cents ? centsToInput(option.price_delta_cents) : '',
  active: keepId ? option.active : true,
  ...(keepId && { loadedActive: option.active }),
  // A copied group starts without photos (they belong to the source options).
  imageUrl: keepId ? option.image_url : null,
  hadImage: keepId && !!option.image_url
});

export const toGroupForm = (group: MenuGroup, keepId: boolean): GroupForm => ({
  key: newKey(),
  ...(keepId && { id: group.id }),
  name: group.name,
  min: group.min,
  max: group.max,
  priceMode: group.price_mode,
  options: group.options.map((option) => toOptionForm(option, keepId))
});

/**
 * The same content as a new group of its own: no ids, every option sends its `active`, no photos.
 */
export const detachGroup = (group: GroupForm): GroupForm => ({
  ...group,
  id: undefined,
  options: group.options.map((option) => ({
    ...option,
    id: undefined,
    loadedActive: undefined,
    imageUrl: null,
    hadImage: false,
    imageChange: undefined
  }))
});

export type GroupInput = ProductInput['groups'][number];

/**
 * The group's request body, or the first problem to show. Mirrors the API validation. `limits: false` skips "escolhe
 * de … a …" (the library edits only the shared part); `sharedMax` is the highest maximum another product chose for
 * this group, which its options may not go below.
 */
export const toGroupInput = (
  group: GroupForm,
  { limits = true, sharedMax = 0 }: { limits?: boolean; sharedMax?: number } = {}
): { input: GroupInput } | { invalid: string } => {
  const label = group.name.trim() || 'Grupo sem nome';
  const { min, max } = group;

  if (!group.name.trim()) {
    return { invalid: 'Dê um nome a cada grupo.' };
  }

  if (!group.options.length || group.options.length > MAX_OPTIONS) {
    return { invalid: `${label}: adicione de 1 a ${MAX_OPTIONS} opções.` };
  }

  if (limits && (max < 1 || min > max)) {
    return { invalid: `${label}: "escolhe de … a …" precisa ir de um número menor a um maior (máximo ao menos 1).` };
  }

  if (limits && max > group.options.length) {
    return { invalid: `${label}: o máximo passa do número de opções.` };
  }

  if (group.options.length < sharedMax) {
    return {
      invalid: `${label}: outro produto deixa escolher até ${sharedMax}. Mantenha ${sharedMax} opções ou separe o grupo.`
    };
  }

  const seen = new Set<string>();
  const options: GroupInput['options'] = [];

  for (const option of group.options) {
    const delta = money(option.price);

    if (!option.name.trim()) {
      return { invalid: `${label}: dê um nome a cada opção.` };
    }

    if (delta === undefined || delta > MAX_PRICE_CENTS) {
      return { invalid: `${label}: preço inválido em ${option.name}.` };
    }

    if (seen.has(normalize(option.name))) {
      return { invalid: `${label}: ${option.name} está repetida.` };
    }

    seen.add(normalize(option.name));
    options.push({
      ...(option.id && { id: option.id }),
      name: option.name,
      price_delta_cents: delta,
      ...(option.active !== option.loadedActive && { active: option.active })
    });
  }

  return {
    input: { ...(group.id && { id: group.id }), name: group.name, min, max, price_mode: group.priceMode, options }
  };
};

export const emptyOption = (): OptionForm => ({ key: newKey(), name: '', price: '', active: true, imageUrl: null });

export const move = <T,>(items: T[], index: number, offset: number) => {
  const next = [...items];
  const target = index + offset;

  if (target < 0 || target >= next.length) {
    return items;
  }

  [next[index], next[target]] = [next[target]!, next[index]!];

  return next;
};

const ICON_BUTTON = 'rounded px-2 py-1 text-muted hover:bg-surface-2 disabled:opacity-30';

export function Stepper(props: { value: number; label: string; onDec?: () => void; onInc?: () => void }) {
  const button = 'h-9 w-8 text-muted hover:bg-hover disabled:opacity-30';

  return (
    <span className="flex items-center rounded-md border border-line-2 bg-surface">
      <button
        type="button"
        disabled={!props.onDec}
        onClick={props.onDec}
        className={`${button} rounded-l-md`}
        aria-label={`Diminuir ${props.label}`}
      >
        −
      </button>
      <span className="min-w-5 text-center font-semibold" aria-label={props.label}>
        {props.value}
      </span>
      <button
        type="button"
        disabled={!props.onInc}
        onClick={props.onInc}
        className={`${button} rounded-r-md`}
        aria-label={`Aumentar ${props.label}`}
      >
        +
      </button>
    </span>
  );
}

function Segment(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={`rounded-md px-3 py-1.5 text-sm ${props.active ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
    >
      {props.children}
    </button>
  );
}

/**
 * One option group of the product form: name, "escolhe de … a …", price mode and its options. The groups library
 * passes `limits={false}` (limits are per product) and no move/remove actions.
 */
export function GroupEditor(props: {
  group: GroupForm;
  onChange: (change: (group: GroupForm) => GroupForm) => void;
  limits?: boolean;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  /**
   * Extra content under each option (the product form puts the stock links there).
   */
  optionExtra?: (option: OptionForm) => ReactNode;
}) {
  const { group, onChange } = props;
  const priced = group.priceMode === 'max';

  const setOption = (key: string, change: Partial<OptionForm>) =>
    onChange((current) => ({
      ...current,
      options: current.options.map((option) => (option.key === key ? { ...option, ...change } : option))
    }));

  const moveOption = (index: number, offset: number) =>
    onChange((current) => ({ ...current, options: move(current.options, index, offset) }));

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-hover px-4 py-3">
        {props.limits !== false && (
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              group.min > 0 ? 'bg-fg-2 text-surface' : 'bg-line text-fg-2'
            }`}
          >
            {group.min > 0 ? 'Obrigatório' : 'Opcional'}
          </span>
        )}
        <input
          value={group.name}
          onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          maxLength={MAX_NAME}
          placeholder="Nome do grupo (ex.: Sabores, Borda)"
          aria-label="Nome do grupo"
          className={`${INPUT} order-last basis-full font-medium sm:order-none sm:basis-auto sm:flex-1`}
        />
        {props.onRemove && (
          <>
            <span className="flex-1 sm:hidden" />
            <button
              type="button"
              disabled={!props.onUp}
              onClick={props.onUp}
              className={ICON_BUTTON}
              aria-label="Subir grupo"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={!props.onDown}
              onClick={props.onDown}
              className={ICON_BUTTON}
              aria-label="Descer grupo"
            >
              ↓
            </button>
            <button type="button" onClick={props.onRemove} className="text-sm text-muted hover:text-fg">
              Remover grupo
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-4 py-3 text-sm text-fg-2">
        <div className={`${props.limits === false ? 'hidden' : 'flex'} flex-wrap items-center gap-2`}>
          Cliente escolhe de
          <Stepper
            value={group.min}
            label="mínimo"
            onDec={group.min > 0 ? () => onChange((current) => ({ ...current, min: current.min - 1 })) : undefined}
            onInc={() =>
              onChange((current) => ({ ...current, min: current.min + 1, max: Math.max(current.max, current.min + 1) }))
            }
          />
          a
          <Stepper
            value={group.max}
            label="máximo"
            onDec={
              group.max > 1
                ? () =>
                    onChange((current) => ({
                      ...current,
                      max: current.max - 1,
                      min: Math.min(current.min, current.max - 1)
                    }))
                : undefined
            }
            onInc={() => onChange((current) => ({ ...current, max: current.max + 1 }))}
          />
          <span className="text-xs text-muted">(0 = opcional)</span>
        </div>

        <div className="grid w-full grid-cols-2 rounded-lg bg-surface-2 p-0.5 sm:ml-auto sm:flex sm:w-auto">
          <Segment active={!priced} onClick={() => onChange((current) => ({ ...current, priceMode: 'sum' }))}>
            Soma as opções
          </Segment>
          <Segment active={priced} onClick={() => onChange((current) => ({ ...current, priceMode: 'max' }))}>
            <span className="sm:hidden">Meio a meio</span>
            <span className="hidden sm:inline">Cobra só a mais cara (meio a meio)</span>
          </Segment>
        </div>
      </div>

      <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_9rem_3rem_6rem] gap-2 px-4 pb-1 pt-3 text-xs text-muted sm:grid">
        <span>Foto</span>
        <span>Opção</span>
        <span>{priced ? 'Preço da opção' : 'Acréscimo'}</span>
        <span>Ativa</span>
      </div>

      <ul className="flex flex-col divide-y divide-line sm:divide-y-0">
        {group.options.map((option, index) => (
          <li
            key={option.key}
            className="flex flex-wrap items-center gap-2 px-4 py-2 sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_3rem_6rem] sm:py-1.5"
          >
            <OptionPhoto
              url={option.imageUrl}
              name={option.name}
              onPick={(blob) =>
                setOption(option.key, { imageUrl: URL.createObjectURL(blob), imageChange: { kind: 'upload', blob } })
              }
              onRemove={() =>
                setOption(option.key, {
                  imageUrl: null,
                  imageChange: option.id && option.hadImage ? { kind: 'remove' } : undefined
                })
              }
            />
            <input
              value={option.name}
              onChange={(event) => setOption(option.key, { name: event.target.value })}
              maxLength={MAX_NAME}
              placeholder="Opção (ex.: Calabresa)"
              aria-label="Nome da opção"
              className={`${INPUT} min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto ${option.active ? '' : 'text-faint line-through'}`}
            />
            <span className="flex min-w-0 flex-1 items-center overflow-hidden rounded-md border border-line-2 bg-surface focus-within:border-accent sm:flex-none">
              <span className="shrink-0 self-stretch whitespace-nowrap border-r border-line bg-hover px-2 py-2 text-xs text-muted">
                {priced ? 'R$' : '+ R$'}
              </span>
              <input
                value={option.price}
                onChange={(event) => setOption(option.key, { price: event.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Preço da opção"
                className="w-full min-w-0 px-2 py-2 text-sm focus:outline-none"
              />
            </span>
            <Toggle
              checked={option.active}
              label={`${option.name || 'Opção'} ativa`}
              onChange={(active) => setOption(option.key, { active })}
            />
            <span className="flex justify-end">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveOption(index, -1)}
                className={ICON_BUTTON}
                aria-label="Subir opção"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === group.options.length - 1}
                onClick={() => moveOption(index, 1)}
                className={ICON_BUTTON}
                aria-label="Descer opção"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    options: current.options.filter(({ key }) => key !== option.key)
                  }))
                }
                className={ICON_BUTTON}
                aria-label="Remover opção"
              >
                ✕
              </button>
            </span>
            {props.optionExtra && <div className="basis-full sm:col-span-full">{props.optionExtra(option)}</div>}
          </li>
        ))}
      </ul>

      <div className="px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={() => onChange((current) => ({ ...current, options: [...current.options, emptyOption()] }))}
          className="text-sm font-medium text-accent-fg hover:text-accent-fg"
        >
          + Opção
        </button>
      </div>
    </div>
  );
}
