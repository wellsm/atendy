import type { FormEvent } from 'react';
import type { MenuCategory, MenuProduct } from '../../lib/queries';

import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ProductEditor } from './product-sheet';
import { Sheet, SheetHeader } from './sheet';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { priceLabel, unavailableText } from '../../lib/menu';
import { useOperator } from '../../lib/operator';
import { usePanelNavigate, usePanelSearch } from '../../lib/panel-search';
import { usePanelSlug } from '../../lib/panel-slug';
import {
  useCreateCategory,
  useDeleteCategory,
  useMenu,
  useRenameCategory,
  useReorderCategories,
  useSetCategoryPreparation,
  useSetOptionActive,
  useSetProductActive
} from '../../lib/queries';
import { Loading } from '../loading';
import { GroupLibrary } from '../menu/group-library';
import { Toggle } from '../toggle';

const INPUT = 'rounded-md border border-line-2 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none';

const ARROW = 'rounded px-1.5 py-1 text-muted hover:bg-surface-2 disabled:opacity-30';

const ALL = 'all';

const enum StatusFilter {
  All = 'all',
  Active = 'active',
  Paused = 'paused'
}

const STATUS_FILTERS: [StatusFilter, string][] = [
  [StatusFilter.All, 'Todos'],
  [StatusFilter.Active, 'Ativos'],
  [StatusFilter.Paused, 'Pausados']
];

const categoryError = (error: unknown) => {
  if (error instanceof ApiError && error.field === 'categories') {
    return 'Limite de 50 categorias.';
  }

  if (error instanceof ApiError && error.status === 400) {
    return 'O nome precisa ter de 1 a 80 caracteres.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * The menu list, a product's form when `?product=` is set, or the groups library with `?groups=true`.
 */
export function MenuSheet({ onClose }: { onClose: () => void }) {
  const menu = useMenu();
  const navigate = usePanelNavigate();
  const search = usePanelSearch();
  // Roles without menu_edit only pause products and options: no product form, no groups library.
  const edit = useOperator().allows('menu_edit');
  const product = edit ? search.product : undefined;
  const groups = edit && search.groups;

  return (
    <Sheet width="lg" label="Cardápio" onClose={onClose}>
      {product && <ProductEditor key={product} productId={product} onClose={onClose} />}

      {!product && groups && (
        <>
          <SheetHeader
            title="Grupos de opções"
            subtitle="Sabores, bebidas, adicionais: um grupo serve para vários produtos."
            onBack={() => void navigate({ sheet: 'menu' })}
            onClose={onClose}
          />
          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4 md:px-6">
            {menu.isPending && <Loading />}
            {menu.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o cardápio.</p>}
            {menu.data && <GroupLibrary categories={menu.data.categories} />}
          </div>
        </>
      )}

      {!product && !groups && (
        <>
          <SheetHeader
            title="Cardápio"
            subtitle="O bot usa o cardápio a partir da próxima mensagem do cliente."
            onClose={onClose}
          />
          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4 md:px-6">
            {menu.isPending && <Loading />}
            {menu.isError && <p className="text-sm text-danger-fg">Não foi possível carregar o cardápio.</p>}
            {menu.data && <Menu categories={menu.data.categories} />}
          </div>
        </>
      )}
    </Sheet>
  );
}

function Menu({ categories }: { categories: MenuCategory[] }) {
  const slug = usePanelSlug();
  const edit = useOperator().allows('menu_edit');
  const reorder = useReorderCategories();
  const [selected, setSelected] = useState(ALL);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(StatusFilter.All);

  // A deleted category falls back to "Todas".
  const current = categories.find(({ id }) => id === selected);
  const products = categories.flatMap((category) => category.products);
  const warnings = products.filter((product) => product.active && unavailableText(product.groups)).length;
  const search = normalize(query);
  const filtering = !!search || status !== StatusFilter.All;

  // Name, description, option groups and options: "atum" finds the pizza that has it as a flavor.
  const searchable = (product: MenuProduct) => [
    product.name,
    product.description ?? '',
    ...product.groups.flatMap((group) => [group.name, ...group.options.map((option) => option.name)])
  ];

  const matches = (product: MenuProduct) =>
    (!search || searchable(product).some((text) => normalize(text).includes(search))) &&
    (status === StatusFilter.All || product.active === (status === StatusFilter.Active));

  const sections = (current ? [current] : categories)
    .map((category) => ({ category, products: category.products.filter(matches) }))
    .filter(({ products }) => !filtering || products.length);

  const move = (index: number, offset: number) => {
    const ids = categories.map(({ id }) => id);
    const target = index + offset;

    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ ids });
  };

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${active ? 'bg-fg text-surface' : 'bg-surface-2 text-fg-2'}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover"
        >
          Página pública ↗
        </a>
        {edit && products.some(({ groups }) => groups.length > 0) && (
          <Link
            to="/panel/$slug"
            params={{ slug }}
            search={{ sheet: 'menu', groups: true }}
            className="flex h-9 items-center rounded-lg border border-line-2 px-3 text-[13px] text-fg-2 hover:bg-hover"
          >
            Grupos de opções
          </Link>
        )}
        {edit && categories.length > 0 && (
          <Link
            to="/panel/$slug"
            params={{ slug }}
            search={{ sheet: 'menu', product: 'new', ...(current && { category: current.id }) }}
            className="flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            + Produto
          </Link>
        )}
      </div>

      {warnings > 0 && (
        <p className="rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          <b className="font-semibold">
            {warnings} {warnings === 1 ? 'produto indisponível' : 'produtos indisponíveis'} para o bot.
          </b>{' '}
          O bot não oferece esses itens até que haja opções disponíveis suficientes.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="order-last flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-2 lg:sticky lg:top-6 lg:order-none">
          <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wider text-muted lg:hidden">Categorias</p>
          <button
            type="button"
            onClick={() => setSelected(ALL)}
            className={`hidden items-center justify-between rounded-lg px-3 py-2 text-left text-sm lg:flex ${
              current ? 'text-fg-2 hover:bg-hover' : 'bg-accent-soft font-medium text-accent-fg'
            }`}
          >
            Todas <span className="text-xs text-muted">{products.length}</span>
          </button>
          {categories.map((category, index) => (
            <div
              key={category.id}
              className={`flex items-center gap-0.5 rounded-lg ${current?.id === category.id ? 'bg-accent-soft' : ''}`}
            >
              <button
                type="button"
                onClick={() => setSelected(category.id)}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pl-3 pr-1.5 text-left text-sm ${
                  current?.id === category.id ? 'font-medium text-accent-fg' : 'text-fg-2'
                }`}
              >
                <span className="truncate">{category.name}</span>
                <span className="text-xs text-muted">{category.products.length}</span>
              </button>
              {edit && (
                <>
                  <button
                    type="button"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                    className={ARROW}
                    aria-label={`Subir ${category.name}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === categories.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                    className={ARROW}
                    aria-label={`Descer ${category.name}`}
                  >
                    ↓
                  </button>
                </>
              )}
            </div>
          ))}
          {reorder.isError && <p className="px-2 py-1 text-xs text-danger-fg">Não foi possível reordenar.</p>}
          {edit && <NewCategory onCreated={setSelected} />}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar produto ou opção"
              aria-label="Buscar produto"
              className={`${INPUT} h-10 min-w-0 flex-1`}
            />
            <div className="flex self-start rounded-lg bg-surface-2 p-0.5">
              {STATUS_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    status === value ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
              <button type="button" onClick={() => setSelected(ALL)} className={chip(!current)}>
                Todas
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelected(category.id)}
                  className={chip(current?.id === category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}

          {!categories.length && (
            <p className="rounded-xl border border-dashed border-line-2 p-6 text-sm text-muted">
              Comece criando uma categoria (ex.: Pizzas).
            </p>
          )}

          {filtering && !sections.length && (
            <p className="rounded-xl border border-dashed border-line-2 p-6 text-sm text-muted">
              Nenhum produto encontrado.
            </p>
          )}

          {sections.map(({ category, products }) => (
            <CategoryCard key={category.id} category={category} products={products} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NewCategory({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateCategory();
  const [name, setName] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim()) {
      create.mutate(
        { name },
        {
          onSuccess: ({ category }) => {
            setName('');
            onCreated(category.id);
          }
        }
      );
    }
  };

  return (
    <form onSubmit={submit} className="mt-1.5 flex flex-col gap-1 border-t border-line px-1 pt-2.5">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nova categoria"
          aria-label="Nova categoria"
          maxLength={80}
          className={`${INPUT} min-w-0 flex-1 py-1.5`}
        />
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-50"
          aria-label="Criar categoria"
        >
          +
        </button>
      </div>
      {create.isError && <span className="px-1 text-xs text-danger-fg">{categoryError(create.error)}</span>}
    </form>
  );
}

function CategoryCard({ category, products }: { category: MenuCategory; products: MenuProduct[] }) {
  const slug = usePanelSlug();
  const edit = useOperator().allows('menu_edit');
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const setPreparation = useSetCategoryPreparation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate({ id: category.id, name }, { onSuccess: () => setEditing(false) });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        {editing ? (
          <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
              aria-label="Nome da categoria"
              className={`${INPUT} min-w-0 flex-1 py-1.5`}
            />
            <button type="submit" disabled={rename.isPending} className="text-sm font-medium text-accent-fg">
              Salvar
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category.name);
              }}
              className="text-sm text-muted"
            >
              Cancelar
            </button>
            {rename.isError && <span className="basis-full text-sm text-danger-fg">{categoryError(rename.error)}</span>}
          </form>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 break-words font-semibold">
              {category.name} <span className="text-sm font-normal text-faint">· {category.products.length}</span>
            </h2>
            {edit && (
              <>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <Toggle
                    checked={category.needs_preparation}
                    label="Precisa de preparo"
                    onChange={(needsPreparation) => setPreparation.mutate({ id: category.id, needsPreparation })}
                  />
                  Precisa de preparo
                </label>
                <button type="button" onClick={() => setEditing(true)} className="text-sm text-muted">
                  Renomear
                </button>
                <button
                  type="button"
                  disabled={category.products.length > 0}
                  title={category.products.length ? 'Remova os produtos antes' : undefined}
                  onClick={() => setConfirmDelete(true)}
                  className="text-sm text-muted disabled:opacity-40"
                >
                  Apagar
                </button>
                <Link
                  to="/panel/$slug"
                  params={{ slug }}
                  search={{ sheet: 'menu', product: 'new', category: category.id }}
                  className="rounded-md border border-accent-line bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent-fg hover:bg-accent-line"
                >
                  + Produto
                </Link>
              </>
            )}
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          <span>Apagar a categoria {category.name}?</span>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(category.id, { onSettled: () => setConfirmDelete(false) })}
            className="rounded-md bg-danger px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            Apagar
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Voltar
          </button>
        </div>
      )}
      {remove.isError && <p className="px-4 pt-3 text-sm text-danger-fg">Não foi possível apagar a categoria.</p>}

      {!category.products.length && <p className="px-4 py-5 text-sm text-muted">Nenhum produto aqui ainda.</p>}

      <ul className="divide-y divide-line">
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>
    </div>
  );
}

function ProductRow({ product }: { product: MenuProduct }) {
  const slug = usePanelSlug();
  const edit = useOperator().allows('menu_edit');
  const setProductActive = useSetProductActive();
  const setOptionActive = useSetOptionActive();
  const unavailable = unavailableText(product.groups);

  return (
    <li className="flex gap-3 px-4 py-3.5">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt=""
          className={`size-14 shrink-0 rounded-[10px] bg-surface-2 object-cover md:size-16 ${product.active ? '' : 'grayscale'}`}
        />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line-2 bg-hover text-center text-[11px] text-faint md:size-16">
          Sem foto
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className={`break-words font-semibold ${product.active ? '' : 'text-faint line-through'}`}>
            {product.name}
          </span>
          <span className="text-sm text-muted">{priceLabel(product)}</span>
          {product.sold_out && (
            <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-warn-fg">Esgotado</span>
          )}
        </div>
        {product.description && <p className="truncate text-sm text-muted">{product.description}</p>}

        {product.active && unavailable && (
          <p className="text-xs text-warn-fg">Indisponível para o bot: {unavailable}.</p>
        )}

        {product.groups.map((group) => (
          <div key={group.id} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{group.name}:</span>
            {group.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={setOptionActive.isPending}
                title={option.active ? 'Marcar como esgotado' : 'Marcar como disponível'}
                onClick={() => setOptionActive.mutate({ id: option.id, active: !option.active })}
                className={`rounded-full border bg-surface px-2 py-0.5 ${
                  option.active ? 'border-line-2 text-fg-2 hover:border-line-2' : 'border-line text-faint line-through'
                }`}
              >
                {option.name}
                {option.price_delta_cents > 0 && ` ${formatMoney(option.price_delta_cents)}`}
                {option.sold_out && <span className="ml-1 font-semibold text-warn-fg">· Esgotado</span>}
              </button>
            ))}
          </div>
        ))}

        {(setProductActive.isError || setOptionActive.isError) && (
          <p className="text-xs text-danger-fg">Não foi possível alterar. Tente novamente.</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2.5">
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="hidden sm:inline">{product.active ? 'Ativo' : 'Pausado'}</span>
          <Toggle
            checked={product.active}
            disabled={setProductActive.isPending}
            label={`${product.name} ativo`}
            onChange={(active) => setProductActive.mutate({ id: product.id, active })}
          />
        </span>
        {edit && (
          <Link
            to="/panel/$slug"
            params={{ slug }}
            search={{ sheet: 'menu', product: product.id }}
            className="text-sm font-medium text-accent-fg hover:text-accent-fg"
          >
            Editar
          </Link>
        )}
      </div>
    </li>
  );
}
