import type { FormEvent } from 'react';
import type {
  ImageChange,
  MenuCategory,
  MenuProduct,
  PendingImages,
  PendingLinks,
  ProductInput,
  StockLinkDraft
} from '../lib/queries';
import type { ApplyCategory } from './menu/apply-group';
import type { GroupForm, OptionForm } from './menu/group-editor';

import { useState } from 'react';

import { ApiError } from '../lib/api';
import { centsToInput } from '../lib/format';
import { unavailableText } from '../lib/menu';
import { useProductStockLinks } from '../lib/queries';
import { ApplyGroup } from './menu/apply-group';
import {
  detachGroup,
  emptyOption,
  GroupEditor,
  INPUT,
  MAX_NAME,
  money,
  move,
  newKey,
  normalize,
  toGroupForm,
  toGroupInput
} from './menu/group-editor';
import { ProductPhoto } from './menu/product-photo';
import { ProductPreview } from './menu/product-preview';
import { StockLinksEditor } from './stock/links-editor';
import { Toggle } from './toggle';

const MAX_DESCRIPTION = 300;

const MAX_GROUPS = 10;

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
  ids: 'O cardápio mudou em outra aba. Recarregue a página e tente de novo.',
  shared_groups:
    'Um grupo compartilhado ficou com menos opções do que outro produto deixa escolher. Recarregue e confira.',
  links: 'O produto foi salvo, mas o estoque vinculado não. Confira os itens e as quantidades e salve de novo.',
  image: 'O produto foi salvo, mas a foto não foi enviada. Envie JPG, PNG ou WebP e salve de novo.'
};

const errorText = (error: unknown) => {
  if (error instanceof ApiError && (error.field === 'image' || error.field === 'links')) {
    return FIELD_ERROR[error.field];
  }

  if (error instanceof ApiError && error.status === 400) {
    return (error.field && FIELD_ERROR[error.field]) || 'Algum valor não é válido. Confira e tente de novo.';
  }

  if (error instanceof ApiError && error.status === 404) {
    return 'Este produto não existe mais. Volte ao cardápio.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

type Form = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  active: boolean;
  needsPreparation: boolean | null;
  loadedActive?: boolean;
  groups: GroupForm[];
};

const toForm = (product: MenuProduct | undefined, categoryId: string): Form => ({
  categoryId: product?.category_id ?? categoryId,
  name: product?.name ?? '',
  description: product?.description ?? '',
  price: product ? centsToInput(product.price_cents) : '',
  active: product?.active ?? true,
  needsPreparation: product?.needs_preparation ?? null,
  ...(product && { loadedActive: product.active }),
  groups: product?.groups.map((group) => toGroupForm(group, true)) ?? []
});

const emptyGroup = (): GroupForm => ({
  key: newKey(),
  name: '',
  min: 1,
  max: 1,
  priceMode: 'sum',
  options: [emptyOption()]
});

/**
 * The request body, or the first problem to show. Mirrors the API validation. `sharedMax` gives, per saved group, the
 * highest maximum the other products linked to it chose.
 */
const toInput = (
  form: Form,
  sharedMax: (group: GroupForm) => number
): { input: ProductInput } | { invalid: string } => {
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
    const result = toGroupInput(group, { sharedMax: sharedMax(group) });

    if ('invalid' in result) {
      return result;
    }

    groups.push(result.input);
  }

  return {
    input: {
      category_id: form.categoryId,
      name: form.name,
      description: form.description.trim() || null,
      price_cents: price,
      needs_preparation: form.needsPreparation,
      ...(form.active !== form.loadedActive && { active: form.active }),
      groups
    }
  };
};

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className="text-xs text-faint">
      {value.length}/{max}
    </span>
  );
}

export function ProductForm(props: {
  product?: MenuProduct;
  categoryId: string;
  categories: MenuCategory[];
  saving: boolean;
  error: unknown;
  /**
   * Photos and stock links to save after the product (changed ones only).
   */
  onSave: (input: ProductInput, images: PendingImages, links: PendingLinks) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  deleteError?: unknown;
}) {
  const [form, setForm] = useState(() => toForm(props.product, props.categoryId));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [applying, setApplying] = useState<string>();
  const [photo, setPhoto] = useState<{ url: string | null; change?: ImageChange }>({
    url: props.product?.image_url ?? null
  });

  // Links the store edited, by `product` or the option's form key; the rest stay as saved.
  const [linkEdits, setLinkEdits] = useState<Record<string, StockLinkDraft[]>>({});
  const [openOption, setOpenOption] = useState<string>();
  const stockLinks = useProductStockLinks(props.product?.id);

  const linksOf = (editKey: string, savedKey: string | undefined) =>
    linkEdits[editKey] ?? (savedKey ? stockLinks.index.get(savedKey) : undefined) ?? [];

  const otherProducts = props.categories
    .flatMap(({ products }) => products)
    .filter(({ id }) => id !== props.product?.id);

  /**
   * The other products linked to a saved group, with their own limits.
   */
  const sharedWith = (groupId: string | undefined) =>
    otherProducts.flatMap((product) =>
      product.groups.filter(({ id }) => id === groupId).map(({ max }) => ({ name: product.name, max }))
    );

  const editedQty = Object.entries(linkEdits).some(
    ([key, links]) =>
      (key === 'product' || form.groups.some((group) => group.options.some((option) => option.key === key))) &&
      links.some(({ qty }) => !qty)
  );

  const result = toInput(form, (group) => Math.max(0, ...sharedWith(group.id).map(({ max }) => max)));
  const invalid =
    'invalid' in result
      ? result.invalid
      : editedQty
        ? 'Informe a quantidade de cada item de estoque vinculado.'
        : undefined;

  // Unparsable prices count as zero here; `invalid` already blocks the save.
  const previewGroups = form.groups.map((group) => ({
    key: group.key,
    name: group.name,
    min: group.min,
    max: group.max,
    price_mode: group.priceMode,
    options: group.options.map(({ active, price }) => ({ active, price_delta_cents: money(price) ?? 0 }))
  }));

  const unavailable = unavailableText(previewGroups);

  // Each group of the other products once, minus the ones already in the form.
  const librarySources = otherProducts
    .flatMap((product) => product.groups)
    .filter((group, index, all) => all.findIndex(({ id }) => id === group.id) === index)
    .filter((group) => !form.groups.some(({ id }) => id === group.id));

  const setGroup = (key: string, change: (group: GroupForm) => GroupForm) =>
    setForm((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.key === key ? change(group) : group))
    }));

  /**
   * The saved group behind a form group, only while the form still matches it: applying copies what is saved.
   */
  const savedGroup = (group: GroupForm) => {
    const saved = props.product?.groups.find(({ id }) => id === group.id);

    const unchanged =
      saved &&
      saved.name === group.name &&
      saved.min === group.min &&
      saved.max === group.max &&
      saved.price_mode === group.priceMode &&
      saved.options.length === group.options.length &&
      saved.options.every(
        (option, index) =>
          option.name === group.options[index]!.name && option.price_delta_cents === money(group.options[index]!.price)
      );

    return unchanged ? saved : undefined;
  };

  const applyTargets = (groupId: string, groupName: string): ApplyCategory[] =>
    props.categories.map((category) => ({
      id: category.id,
      name: category.name,
      products: category.products
        .filter(({ id }) => id !== props.product?.id)
        .map((product) => ({
          id: product.id,
          name: product.name,
          hasGroup: product.groups.some(({ id, name }) => id === groupId || normalize(name) === normalize(groupName))
        }))
    }));

  // Links the group: same ids, so the save shares it; the limits start as that product's.
  const linkGroup = (value: string) => {
    const source = librarySources.find(({ id }) => id === value);

    if (source) {
      setForm((current) => ({ ...current, groups: [...current.groups, toGroupForm(source, true)] }));
    }
  };

  const optionStock = (option: OptionForm) => {
    if (!option.id) {
      return <span className="text-xs text-faint">Salve o produto para vincular estoque a esta opção.</span>;
    }

    const links = linksOf(option.key, `option:${option.id}`);
    const open = openOption === option.key;

    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={stockLinks.isPending || stockLinks.isError}
          onClick={() => setOpenOption(open ? undefined : option.key)}
          className="self-start text-xs font-medium text-accent-fg disabled:text-faint"
        >
          {links.length ? `Estoque: ${links.map(({ name }) => name).join(', ')}` : 'Vincular estoque'}
        </button>
        {open && (
          <StockLinksEditor
            links={links}
            onChange={(next) => setLinkEdits((current) => ({ ...current, [option.key]: next }))}
            createName={option.name}
          />
        )}
      </div>
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    // The inline "criar item" form is a form of its own inside this one.
    if (event.target !== event.currentTarget) {
      return;
    }

    if ('input' in result && !props.saving) {
      props.onSave(
        result.input,
        {
          product: photo.change,
          options: form.groups.flatMap((group, groupIndex) =>
            group.options.flatMap((option, optionIndex) =>
              option.imageChange ? [{ group: groupIndex, option: optionIndex, change: option.imageChange }] : []
            )
          )
        },
        {
          product: linkEdits.product,
          options: form.groups.flatMap((group, groupIndex) =>
            group.options.flatMap((option, optionIndex) => {
              const links = linkEdits[option.key];

              return links ? [{ group: groupIndex, option: optionIndex, links }] : [];
            })
          )
        }
      );
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-5 rounded-xl border border-line bg-surface p-4 sm:p-5 md:grid-cols-[12.5rem_minmax(0,1fr)]">
            <ProductPhoto
              url={photo.url}
              onPick={(blob) => setPhoto({ url: URL.createObjectURL(blob), change: { kind: 'upload', blob } })}
              onRemove={() =>
                setPhoto({ url: null, change: props.product?.image_url ? { kind: 'remove' } : undefined })
              }
            />
            <div className="grid content-start gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="flex justify-between">
                  Nome <Counter value={form.name} max={MAX_NAME} />
                </span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  maxLength={MAX_NAME}
                  placeholder="Pizza Grande"
                  className={INPUT}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
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

              <label className="flex flex-col gap-1.5 text-sm">
                Preparo
                <select
                  value={String(form.needsPreparation)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      needsPreparation: event.target.value === 'null' ? null : event.target.value === 'true'
                    })
                  }
                  className={INPUT}
                >
                  <option value="null">Igual à categoria</option>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                Preço base
                <span className="flex items-center overflow-hidden rounded-md border border-line-2 bg-surface focus-within:border-accent">
                  <span className="self-stretch border-r border-line bg-hover px-3 py-2 text-muted">R$</span>
                  <input
                    value={form.price}
                    onChange={(event) => setForm({ ...form, price: event.target.value })}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="w-full min-w-0 px-3 py-2 text-sm focus:outline-none"
                  />
                </span>
              </label>

              <span className="-mt-2 text-xs text-muted sm:col-span-2">
                Deixe 0 quando o preço vem das opções (ex.: cada sabor tem seu preço).
              </span>

              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="flex justify-between">
                  Descrição (opcional) <Counter value={form.description} max={MAX_DESCRIPTION} />
                </span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  maxLength={MAX_DESCRIPTION}
                  rows={3}
                  placeholder="8 fatias. Até 2 sabores."
                  className={INPUT}
                />
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-line bg-hover px-3.5 py-3 sm:col-span-2">
                <Toggle
                  checked={form.active}
                  label="Disponível para o bot"
                  onChange={(active) => setForm({ ...form, active })}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Disponível para o bot</span>
                  <span className="text-xs text-muted">Desligue para pausar sem apagar o produto.</span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-col">
              <h2 className="font-semibold">Estoque</h2>
              <span className="text-sm text-muted">
                O que sai do estoque a cada unidade vendida. Quando acabar, o produto aparece como esgotado.
              </span>
            </div>
            {stockLinks.isPending && <span className="text-sm text-muted">Carregando vínculos…</span>}
            {stockLinks.isError && (
              <span className="text-sm text-danger-fg">Não foi possível carregar os vínculos de estoque.</span>
            )}
            {!stockLinks.isPending && !stockLinks.isError && (
              <StockLinksEditor
                links={linksOf('product', props.product && `product:${props.product.id}`)}
                onChange={(links) => setLinkEdits((current) => ({ ...current, product: links }))}
                createName={form.name}
              />
            )}
          </div>

          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="font-semibold">Grupos de opções</h2>
              <span className="text-sm text-muted">Sabores, borda, adicionais, ponto da carne…</span>
            </div>
            <span className="shrink-0 text-xs text-faint">
              {form.groups.length}/{MAX_GROUPS} grupos
            </span>
          </div>

          {form.groups.map((group, index) => {
            const saved = savedGroup(group);
            const shared = sharedWith(group.id);

            return (
              <div key={group.key} className="flex flex-col gap-2">
                <GroupEditor
                  group={group}
                  onChange={(change) => setGroup(group.key, change)}
                  onUp={index > 0 ? () => setForm({ ...form, groups: move(form.groups, index, -1) }) : undefined}
                  onDown={
                    index < form.groups.length - 1
                      ? () => setForm({ ...form, groups: move(form.groups, index, 1) })
                      : undefined
                  }
                  onRemove={() => setForm({ ...form, groups: form.groups.filter(({ key }) => key !== group.key) })}
                  optionExtra={optionStock}
                />

                {shared.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                    <span className="min-w-0 flex-1">
                      Também em {shared.length === 1 ? '1 produto' : `${shared.length} produtos`} (
                      {shared.map(({ name }) => name).join(', ')}). Nome, opções e preços mudam em todos; "escolhe de …
                      a …" vale só aqui.
                    </span>
                    <button
                      type="button"
                      onClick={() => setGroup(group.key, detachGroup)}
                      className="font-medium text-accent-fg"
                    >
                      Separar só para este produto
                    </button>
                  </div>
                )}

                {group.id &&
                  (saved && applying === group.key ? (
                    <ApplyGroup
                      groupId={saved.id}
                      groupName={saved.name}
                      optionCount={saved.options.length}
                      min={saved.min}
                      max={saved.max}
                      categories={applyTargets(saved.id, saved.name)}
                      onClose={() => setApplying(undefined)}
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!saved}
                      onClick={() => setApplying(group.key)}
                      className="self-start text-sm font-medium text-accent-fg disabled:text-faint"
                    >
                      {saved ? 'Aplicar em outros produtos…' : 'Salve o produto para aplicar este grupo em outros'}
                    </button>
                  ))}
              </div>
            );
          })}

          {!form.groups.length && (
            <p className="rounded-xl border border-dashed border-line-2 p-5 text-sm text-muted">
              Sem grupos: o cliente pede o produto como está, pelo preço base. Adicione um grupo para sabores, tamanhos
              ou adicionais.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              disabled={form.groups.length >= MAX_GROUPS}
              onClick={() => setForm({ ...form, groups: [...form.groups, emptyGroup()] })}
              className="rounded-lg border border-line-2 bg-surface px-3.5 py-2 text-sm hover:bg-hover disabled:opacity-50"
            >
              + Grupo
            </button>

            {librarySources.length > 0 && (
              <select
                value=""
                disabled={form.groups.length >= MAX_GROUPS}
                onChange={(event) => linkGroup(event.target.value)}
                aria-label="Usar grupo de outro produto"
                className={`${INPUT} min-w-0 text-fg-2`}
              >
                <option value="">Usar grupo existente…</option>
                {librarySources.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ·{' '}
                    {group.options
                      .slice(0, 4)
                      .map(({ name }) => name)
                      .join(', ')}
                    {group.options.length > 4 && '…'}
                  </option>
                ))}
              </select>
            )}
          </div>

          {unavailable && (
            <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-fg lg:hidden">
              Indisponível para o bot: {unavailable}.
            </p>
          )}
        </div>

        <aside className="hidden lg:sticky lg:top-6 lg:block">
          <ProductPreview
            name={form.name}
            description={form.description}
            priceCents={money(form.price) ?? 0}
            imageUrl={photo.url}
            active={form.active}
            groups={previewGroups}
            unavailable={unavailable}
            invalid={invalid}
          />
        </aside>
      </div>

      <div className="z-10 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur md:sticky md:bottom-4">
        <button
          type="submit"
          disabled={props.saving || !!invalid}
          className="h-10 flex-1 rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:flex-none"
        >
          {props.saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={props.onCancel} className="text-sm text-muted hover:text-fg">
          Voltar
        </button>
        {invalid && <span className="basis-full text-sm text-warn-fg sm:basis-auto">{invalid}</span>}
        {!invalid && props.error != null && (
          <span className="basis-full text-sm text-danger-fg sm:basis-auto">{errorText(props.error)}</span>
        )}

        {props.onDelete && !confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-muted hover:text-danger-fg sm:ml-auto"
          >
            Apagar produto
          </button>
        )}

        {props.onDelete && confirmDelete && (
          <div className="flex basis-full flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg sm:ml-auto sm:basis-auto">
            <span>Apagar {props.product?.name}? Pedidos já feitos não mudam.</span>
            <button
              type="button"
              disabled={props.deleting}
              onClick={props.onDelete}
              className="rounded-md bg-danger px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              Apagar
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              Voltar
            </button>
            {props.deleteError != null && <span className="text-danger-fg">Não foi possível apagar.</span>}
          </div>
        )}
      </div>
    </form>
  );
}
