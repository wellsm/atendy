import type { FormEvent } from 'react';
import type { MenuCategory, MenuGroup, MenuProduct, PriceMode, ProductInput } from '../lib/queries';

import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiError } from '../lib/api';
import { centsToInput, parseMoney } from '../lib/format';
import { unavailableText } from '../lib/menu';

const INPUT =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none disabled:bg-neutral-50';

const MAX_NAME = 80;

const MAX_DESCRIPTION = 300;

const MAX_GROUPS = 10;

const MAX_OPTIONS = 100;

const MAX_PRICE_CENTS = 10_000_000;

/**
 * Portuguese text per API error field; the API messages are for developers.
 */
const FIELD_ERROR: Record<string, string> = {
  name: 'O nome do produto precisa ter de 1 a 80 caracteres.',
  description: 'A descrição pode ter no máximo 300 caracteres.',
  price_cents: 'O preço precisa ser entre R$ 0 e R$ 100.000.',
  category_id: 'Escolha uma categoria do cardápio.',
  groups: 'Confira os grupos: nome, quantidade de opções e "escolhe de … a …".',
  options: 'Confira as opções: nomes repetidos ou vazios, ou preço inválido.',
  ids: 'O cardápio mudou em outra aba. Recarregue a página e tente de novo.'
};

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 400) {
    return (error.field && FIELD_ERROR[error.field]) || 'Algum valor não é válido. Confira e tente de novo.';
  }

  if (error instanceof ApiError && error.status === 404) {
    return 'Este produto não existe mais. Volte ao cardápio.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

type OptionForm = {
  key: string;
  id?: string;
  name: string;
  price: string;
  active: boolean;
  /**
   * `active` when the form opened; the save sends `active` only when it changed (see `ProductInput`).
   */
  loadedActive?: boolean;
};

type GroupForm = {
  key: string;
  id?: string;
  name: string;
  min: string;
  max: string;
  priceMode: PriceMode;
  options: OptionForm[];
};

type Form = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  active: boolean;
  loadedActive?: boolean;
  groups: GroupForm[];
};

const newKey = () => crypto.randomUUID();

const toOptionForm = (option: MenuGroup['options'][number], keepId: boolean): OptionForm => ({
  key: newKey(),
  ...(keepId && { id: option.id }),
  name: option.name,
  price: option.price_delta_cents ? centsToInput(option.price_delta_cents) : '',
  active: keepId ? option.active : true,
  ...(keepId && { loadedActive: option.active })
});

const toGroupForm = (group: MenuGroup, keepId: boolean): GroupForm => ({
  key: newKey(),
  ...(keepId && { id: group.id }),
  name: group.name,
  min: String(group.min),
  max: String(group.max),
  priceMode: group.price_mode,
  options: group.options.map((option) => toOptionForm(option, keepId))
});

const toForm = (product: MenuProduct | undefined, categoryId: string): Form => ({
  categoryId: product?.category_id ?? categoryId,
  name: product?.name ?? '',
  description: product?.description ?? '',
  price: product ? centsToInput(product.price_cents) : '',
  active: product?.active ?? true,
  ...(product && { loadedActive: product.active }),
  groups: product?.groups.map((group) => toGroupForm(group, true)) ?? []
});

const emptyOption = (): OptionForm => ({ key: newKey(), name: '', price: '', active: true });

const emptyGroup = (): GroupForm => ({
  key: newKey(),
  name: '',
  min: '1',
  max: '1',
  priceMode: 'sum',
  options: [emptyOption()]
});

/**
 * Empty money field means zero.
 */
const money = (text: string) => (text.trim() ? parseMoney(text) : 0);

const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : undefined);

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The request body, or the first problem to show. Mirrors the API validation.
 */
const toInput = (form: Form): { input: ProductInput } | { invalid: string } => {
  const price = money(form.price);

  if (!form.name.trim()) {
    return { invalid: 'Dê um nome ao produto.' };
  }

  if (price === undefined || price > MAX_PRICE_CENTS) {
    return { invalid: 'Preço inválido. Use o formato 12,50.' };
  }

  if (form.groups.length > MAX_GROUPS) {
    return { invalid: `No máximo ${MAX_GROUPS} grupos.` };
  }

  const groups: ProductInput['groups'] = [];

  for (const group of form.groups) {
    const label = group.name.trim() || 'Grupo sem nome';
    const min = integer(group.min);
    const max = integer(group.max);

    if (!group.name.trim()) {
      return { invalid: 'Dê um nome a cada grupo.' };
    }

    if (!group.options.length || group.options.length > MAX_OPTIONS) {
      return { invalid: `${label}: adicione de 1 a ${MAX_OPTIONS} opções.` };
    }

    if (min === undefined || max === undefined || max < 1 || min > max) {
      return { invalid: `${label}: "escolhe de … a …" precisa ir de um número menor a um maior (máximo ao menos 1).` };
    }

    if (max > group.options.length) {
      return { invalid: `${label}: o máximo passa do número de opções.` };
    }

    const seen = new Set<string>();
    const options: ProductInput['groups'][number]['options'] = [];

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

    groups.push({
      ...(group.id && { id: group.id }),
      name: group.name,
      min,
      max,
      price_mode: group.priceMode,
      options
    });
  }

  return {
    input: {
      category_id: form.categoryId,
      name: form.name,
      description: form.description.trim() || null,
      price_cents: price,
      ...(form.active !== form.loadedActive && { active: form.active }),
      groups
    }
  };
};

const move = <T,>(items: T[], index: number, offset: number) => {
  const next = [...items];
  const target = index + offset;

  if (target < 0 || target >= next.length) {
    return items;
  }

  [next[index], next[target]] = [next[target]!, next[index]!];

  return next;
};

export function ProductForm(props: {
  product?: MenuProduct;
  categoryId: string;
  categories: MenuCategory[];
  saving: boolean;
  error: unknown;
  onSave: (input: ProductInput) => void;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: unknown;
}) {
  const [form, setForm] = useState(() => toForm(props.product, props.categoryId));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const result = toInput(form);
  const invalid = 'invalid' in result ? result.invalid : undefined;

  const unavailable = unavailableText(
    form.groups.map((group) => ({
      name: group.name,
      min: integer(group.min) ?? 0,
      price_mode: group.priceMode,
      options: group.options.map(({ active }) => ({ active, price_delta_cents: 0 }))
    }))
  );

  const copySources = props.categories
    .flatMap(({ products }) => products)
    .filter(({ id }) => id !== props.product?.id)
    .flatMap((product) => product.groups.map((group) => ({ product, group })));

  const setGroup = (key: string, change: (group: GroupForm) => GroupForm) =>
    setForm((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.key === key ? change(group) : group))
    }));

  const setOption = (groupKey: string, optionKey: string, change: Partial<OptionForm>) =>
    setGroup(groupKey, (group) => ({
      ...group,
      options: group.options.map((option) => (option.key === optionKey ? { ...option, ...change } : option))
    }));

  const copyGroup = (value: string) => {
    const source = copySources.find(({ group }) => group.id === value);

    if (source) {
      setForm((current) => ({ ...current, groups: [...current.groups, toGroupForm(source.group, false)] }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if ('input' in result && !props.saving) {
      props.onSave(result.input);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Categoria
            <select
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              className={INPUT}
            >
              {props.categories.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Nome
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              maxLength={MAX_NAME}
              placeholder="Pizza Grande"
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Descrição (opcional)
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              maxLength={MAX_DESCRIPTION}
              rows={2}
              placeholder="8 fatias. Até 2 sabores."
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Preço base (R$)
            <input
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              inputMode="decimal"
              placeholder="0,00"
              className={INPUT}
            />
            <span className="text-xs text-neutral-500">
              Deixe 0 quando o preço vem das opções (ex.: cada sabor tem seu preço).
            </span>
          </label>

          <label className="flex items-center gap-2 self-center text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
            />
            Disponível para o bot
          </label>
        </div>
      </div>

      {form.groups.map((group, groupIndex) => (
        <div key={group.key} className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={group.name}
              onChange={(event) => setGroup(group.key, (current) => ({ ...current, name: event.target.value }))}
              maxLength={MAX_NAME}
              placeholder="Nome do grupo (ex.: Sabores, Borda)"
              className={`${INPUT} flex-1`}
            />
            <button
              type="button"
              disabled={groupIndex === 0}
              onClick={() => setForm({ ...form, groups: move(form.groups, groupIndex, -1) })}
              className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
              aria-label="Subir grupo"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={groupIndex === form.groups.length - 1}
              onClick={() => setForm({ ...form, groups: move(form.groups, groupIndex, 1) })}
              className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
              aria-label="Descer grupo"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, groups: form.groups.filter(({ key }) => key !== group.key) })}
              className="text-sm text-neutral-600"
            >
              Remover grupo
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            Cliente escolhe de
            <input
              value={group.min}
              onChange={(event) => setGroup(group.key, (current) => ({ ...current, min: event.target.value }))}
              inputMode="numeric"
              className={`${INPUT} w-16`}
              aria-label="Mínimo"
            />
            a
            <input
              value={group.max}
              onChange={(event) => setGroup(group.key, (current) => ({ ...current, max: event.target.value }))}
              inputMode="numeric"
              className={`${INPUT} w-16`}
              aria-label="Máximo"
            />
            <span className="text-xs text-neutral-500">(0 = opcional)</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={group.priceMode === 'sum'}
                onChange={() => setGroup(group.key, (current) => ({ ...current, priceMode: 'sum' }))}
              />
              Soma as opções
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={group.priceMode === 'max'}
                onChange={() => setGroup(group.key, (current) => ({ ...current, priceMode: 'max' }))}
              />
              Cobra só a mais cara (meio a meio)
            </label>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {group.options.map((option, optionIndex) => (
              <li key={option.key} className="flex flex-wrap items-center gap-2">
                <input
                  value={option.name}
                  onChange={(event) => setOption(group.key, option.key, { name: event.target.value })}
                  maxLength={MAX_NAME}
                  placeholder="Opção (ex.: Calabresa)"
                  className={`${INPUT} min-w-40 flex-1`}
                />
                <span className="text-sm text-neutral-500">+ R$</span>
                <input
                  value={option.price}
                  onChange={(event) => setOption(group.key, option.key, { price: event.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                  className={`${INPUT} w-24`}
                />
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={option.active}
                    onChange={(event) => setOption(group.key, option.key, { active: event.target.checked })}
                  />
                  Ativa
                </label>
                <button
                  type="button"
                  disabled={optionIndex === 0}
                  onClick={() =>
                    setGroup(group.key, (current) => ({ ...current, options: move(current.options, optionIndex, -1) }))
                  }
                  className="rounded px-1.5 text-neutral-500 disabled:opacity-30"
                  aria-label="Subir opção"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={optionIndex === group.options.length - 1}
                  onClick={() =>
                    setGroup(group.key, (current) => ({ ...current, options: move(current.options, optionIndex, 1) }))
                  }
                  className="rounded px-1.5 text-neutral-500 disabled:opacity-30"
                  aria-label="Descer opção"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setGroup(group.key, (current) => ({
                      ...current,
                      options: current.options.filter(({ key }) => key !== option.key)
                    }))
                  }
                  className="px-1.5 text-neutral-500"
                  aria-label="Remover opção"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() =>
              setGroup(group.key, (current) => ({ ...current, options: [...current.options, emptyOption()] }))
            }
            className="mt-3 text-sm font-medium text-red-700"
          >
            + Opção
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setForm({ ...form, groups: [...form.groups, emptyGroup()] })}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          + Grupo
        </button>

        {copySources.length > 0 && (
          <select value="" onChange={(event) => copyGroup(event.target.value)} className={INPUT}>
            <option value="">Copiar grupo de…</option>
            {copySources.map(({ product, group }) => (
              <option key={group.id} value={group.id}>
                {product.name} › {group.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {unavailable && <p className="text-sm text-amber-700">Indisponível para o bot: {unavailable}.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={props.saving || !!invalid}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {props.saving ? 'Salvando…' : 'Salvar'}
        </button>
        <Link to="/cardapio" className="text-sm text-neutral-600">
          Voltar
        </Link>
        {invalid && <span className="text-sm text-amber-700">{invalid}</span>}
        {!invalid && props.error != null && <span className="text-sm text-red-700">{errorText(props.error)}</span>}

        {props.onDelete && !confirmDelete && (
          <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto text-sm text-neutral-600">
            Apagar produto
          </button>
        )}
      </div>

      {props.onDelete && confirmDelete && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <span>Apagar {props.product?.name}? Pedidos já feitos não mudam.</span>
          <button
            type="button"
            disabled={props.deleting}
            onClick={props.onDelete}
            className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            Apagar
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Voltar
          </button>
          {props.deleteError != null && <span className="text-red-700">Não foi possível apagar.</span>}
        </div>
      )}
    </form>
  );
}
