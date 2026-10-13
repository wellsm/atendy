import type { FormEvent } from 'react';
import type { MenuCategory, MenuProduct } from '../../lib/queries';

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Loading } from '../../components/loading';
import { Toggle } from '../../components/toggle';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { priceLabel, unavailableText } from '../../lib/menu';
import {
  useCreateCategory,
  useDeleteCategory,
  useMenu,
  useRenameCategory,
  useReorderCategories,
  useSetOptionActive,
  useSetProductActive
} from '../../lib/queries';

export const Route = createFileRoute('/_panel/cardapio/')({
  component: MenuPage
});

const INPUT = 'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none';

const categoryError = (error: unknown) => {
  if (error instanceof ApiError && error.field === 'categories') {
    return 'Limite de 50 categorias.';
  }

  if (error instanceof ApiError && error.status === 400) {
    return 'O nome precisa ter de 1 a 80 caracteres.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

function MenuPage() {
  const menu = useMenu();

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Cardápio</h1>
      <p className="mt-1 text-sm text-neutral-500">O bot usa este cardápio a partir da próxima mensagem do cliente.</p>

      {menu.isPending && <Loading />}
      {menu.isError && <p className="mt-6 text-sm text-red-700">Não foi possível carregar o cardápio.</p>}
      {menu.data && <Categories categories={menu.data.categories} />}
    </section>
  );
}

function Categories({ categories }: { categories: MenuCategory[] }) {
  const reorder = useReorderCategories();

  const move = (index: number, offset: number) => {
    const ids = categories.map(({ id }) => id);
    const target = index + offset;

    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ ids });
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {!categories.length && (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-600">
          Comece criando uma categoria (ex.: Pizzas).
        </p>
      )}

      {categories.map((category, index) => (
        <CategoryCard
          key={category.id}
          category={category}
          categories={categories}
          moving={reorder.isPending}
          onUp={index > 0 ? () => move(index, -1) : undefined}
          onDown={index < categories.length - 1 ? () => move(index, 1) : undefined}
        />
      ))}

      {reorder.isError && <p className="text-sm text-red-700">Não foi possível reordenar. Tente novamente.</p>}

      <NewCategory />
    </div>
  );
}

function NewCategory() {
  const create = useCreateCategory();
  const [name, setName] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim()) {
      create.mutate({ name }, { onSuccess: () => setName('') });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nova categoria"
        maxLength={80}
        className={INPUT}
      />
      <button
        type="submit"
        disabled={create.isPending || !name.trim()}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        + Categoria
      </button>
      {create.isError && <span className="text-sm text-red-700">{categoryError(create.error)}</span>}
    </form>
  );
}

function CategoryCard(props: {
  category: MenuCategory;
  categories: MenuCategory[];
  moving: boolean;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const { category } = props;
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate({ id: category.id, name }, { onSuccess: () => setEditing(false) });
  };

  const arrow = 'rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30';

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-3">
        {editing ? (
          <form onSubmit={submit} className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
              className={INPUT}
            />
            <button type="submit" disabled={rename.isPending} className="text-sm font-medium text-red-700">
              Salvar
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category.name);
              }}
              className="text-sm text-neutral-600"
            >
              Cancelar
            </button>
            {rename.isError && <span className="text-sm text-red-700">{categoryError(rename.error)}</span>}
          </form>
        ) : (
          <>
            <h2 className="flex-1 font-semibold">{category.name}</h2>
            <button
              type="button"
              disabled={!props.onUp || props.moving}
              onClick={props.onUp}
              className={arrow}
              aria-label="Subir"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={!props.onDown || props.moving}
              onClick={props.onDown}
              className={arrow}
              aria-label="Descer"
            >
              ↓
            </button>
            <button type="button" onClick={() => setEditing(true)} className="text-sm text-neutral-600">
              Renomear
            </button>
            <button
              type="button"
              disabled={category.products.length > 0}
              title={category.products.length ? 'Remova os produtos antes' : undefined}
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-neutral-600 disabled:opacity-40"
            >
              Apagar
            </button>
          </>
        )}
      </div>

      {confirmDelete && (
        <div className="flex flex-wrap items-center gap-3 border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>Apagar a categoria {category.name}?</span>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(category.id, { onSettled: () => setConfirmDelete(false) })}
            className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            Apagar
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Voltar
          </button>
        </div>
      )}
      {remove.isError && <p className="px-4 pt-3 text-sm text-red-700">Não foi possível apagar a categoria.</p>}

      <ul className="divide-y divide-neutral-100">
        {category.products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>

      <div className="px-4 py-3">
        <Link to="/cardapio/novo" search={{ categoria: category.id }} className="text-sm font-medium text-red-700">
          + Produto
        </Link>
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: MenuProduct }) {
  const setProductActive = useSetProductActive();
  const setOptionActive = useSetOptionActive();
  const unavailable = unavailableText(product.groups);

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Toggle
          checked={product.active}
          disabled={setProductActive.isPending}
          label={`${product.name} ativo`}
          onChange={(active) => setProductActive.mutate({ id: product.id, active })}
        />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-medium ${product.active ? '' : 'text-neutral-400 line-through'}`}>
            {product.name}
          </p>
          <p className="text-sm text-neutral-500">{priceLabel(product)}</p>
        </div>
        <Link to="/cardapio/$productId" params={{ productId: product.id }} className="text-sm font-medium text-red-700">
          Editar
        </Link>
      </div>

      {product.active && unavailable && (
        <p className="mt-2 text-xs text-amber-700">Indisponível para o bot: {unavailable}.</p>
      )}

      {product.groups.map((group) => (
        <div key={group.id} className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-500">{group.name}:</span>
          {group.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={setOptionActive.isPending}
              title={option.active ? 'Marcar como esgotado' : 'Marcar como disponível'}
              onClick={() => setOptionActive.mutate({ id: option.id, active: !option.active })}
              className={`rounded-full border px-2 py-0.5 ${
                option.active
                  ? 'border-neutral-300 text-neutral-700'
                  : 'border-neutral-200 text-neutral-400 line-through'
              }`}
            >
              {option.name}
              {option.price_delta_cents > 0 && ` ${formatMoney(option.price_delta_cents)}`}
            </button>
          ))}
        </div>
      ))}

      {(setProductActive.isError || setOptionActive.isError) && (
        <p className="mt-2 text-xs text-red-700">Não foi possível alterar. Tente novamente.</p>
      )}
    </li>
  );
}
