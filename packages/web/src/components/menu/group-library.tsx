import type { ApplyCategory } from './apply-group';
import type { MenuCategory, MenuGroup, PendingImages } from '../../lib/queries';

import { useState } from 'react';

import { ApplyGroup } from './apply-group';
import { GroupEditor, normalize, toGroupForm, toGroupInput } from './group-editor';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useDeleteGroup, useSaveGroupImages, useUpdateGroup } from '../../lib/queries';

type LibraryGroup = {
  group: MenuGroup;
  products: { id: string; name: string; max: number }[];
};

const enum Mode {
  View = 'view',
  Edit = 'edit',
  Apply = 'apply',
  Delete = 'delete'
}

/**
 * Every group of the menu once, with the products linked to it (a group always has at least one).
 */
const libraryGroups = (categories: MenuCategory[]): LibraryGroup[] => {
  const groups = new Map<string, LibraryGroup>();

  for (const product of categories.flatMap(({ products }) => products)) {
    for (const group of product.groups) {
      const entry = groups.get(group.id) ?? { group, products: [] };

      entry.products.push({ id: product.id, name: product.name, max: group.max });
      groups.set(group.id, entry);
    }
  }

  return [...groups.values()].sort((a, b) => a.group.name.localeCompare(b.group.name));
};

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.field === 'shared_groups') {
    return 'Algum produto deixa escolher mais opções do que o grupo teria. Ajuste o máximo nesse produto antes.';
  }

  if (error instanceof ApiError && error.field === 'image') {
    return 'O grupo foi salvo, mas alguma foto não foi enviada. Envie JPG, PNG ou WebP e salve de novo.';
  }

  if (error instanceof ApiError && error.status === 400) {
    return 'Confira o grupo: nome, opções repetidas ou vazias, ou preço inválido.';
  }

  return 'Não foi possível salvar. Tente novamente.';
};

/**
 * The option groups of the menu: edit one for every product that uses it, link it to more products or delete it.
 */
export function GroupLibrary({ categories }: { categories: MenuCategory[] }) {
  const groups = libraryGroups(categories);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Um grupo pode estar em vários produtos. Editar aqui muda nome, opções e preços em todos eles; &quot;escolhe de …
        a …&quot; é de cada produto.
      </p>

      {!groups.length && (
        <p className="rounded-xl border border-dashed border-line-2 p-6 text-sm text-muted">
          Nenhum grupo ainda. Crie grupos no formulário de um produto.
        </p>
      )}

      {groups.map((entry) => (
        <LibraryRow key={entry.group.id} entry={entry} categories={categories} />
      ))}
    </div>
  );
}

function LibraryRow({ entry, categories }: { entry: LibraryGroup; categories: MenuCategory[] }) {
  const remove = useDeleteGroup();
  const [mode, setMode] = useState(Mode.View);
  const { group, products } = entry;

  const targets: ApplyCategory[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    products: category.products.map((product) => ({
      id: product.id,
      name: product.name,
      hasGroup: product.groups.some(({ id, name }) => id === group.id || normalize(name) === normalize(group.name))
    }))
  }));

  if (mode === Mode.Edit) {
    return (
      <GroupEdit
        group={group}
        sharedMax={Math.max(...products.map(({ max }) => max))}
        onDone={() => setMode(Mode.View)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 break-words font-semibold">{group.name}</h3>
        <span className="text-xs text-muted">
          {group.price_mode === 'max' ? 'Cobra só a mais cara' : 'Soma as opções'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {group.options.map((option) => (
          <span
            key={option.id}
            className={`rounded-full border px-2 py-0.5 ${
              option.active ? 'border-line-2 text-fg-2' : 'border-line text-faint line-through'
            }`}
          >
            {option.name}
            {option.price_delta_cents > 0 && ` ${formatMoney(option.price_delta_cents)}`}
          </span>
        ))}
      </div>

      <p className="text-[13px] text-muted">
        Em {products.length === 1 ? '1 produto' : `${products.length} produtos`}:{' '}
        {products.map(({ name }) => name).join(', ')}
      </p>

      {mode === Mode.View && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <button type="button" onClick={() => setMode(Mode.Edit)} className="font-medium text-accent-fg">
            Editar
          </button>
          <button type="button" onClick={() => setMode(Mode.Apply)} className="font-medium text-accent-fg">
            Aplicar em produtos…
          </button>
          <button type="button" onClick={() => setMode(Mode.Delete)} className="text-muted hover:text-danger-fg">
            Apagar
          </button>
        </div>
      )}

      {mode === Mode.Apply && (
        <ApplyGroup
          groupId={group.id}
          groupName={group.name}
          optionCount={group.options.length}
          min={group.min}
          max={group.max}
          categories={targets}
          onClose={() => setMode(Mode.View)}
        />
      )}

      {mode === Mode.Delete && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          <span>
            Apagar {group.name}? Sai de {products.length === 1 ? '1 produto' : `${products.length} produtos`}; pedidos
            já feitos não mudam.
          </span>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(group.id)}
            className="rounded-md bg-danger px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            Apagar
          </button>
          <button type="button" onClick={() => setMode(Mode.View)}>
            Voltar
          </button>
          {remove.isError && <span>Não foi possível apagar.</span>}
        </div>
      )}
    </div>
  );
}

function GroupEdit(props: { group: MenuGroup; sharedMax: number; onDone: () => void }) {
  const update = useUpdateGroup();
  const saveImages = useSaveGroupImages();
  const [form, setForm] = useState(() => toGroupForm(props.group, true));

  const result = toGroupInput(form, { limits: false, sharedMax: props.sharedMax });
  const invalid = 'invalid' in result ? result.invalid : undefined;
  const saving = update.isPending || saveImages.isPending;

  const save = () => {
    if (!('input' in result) || saving) {
      return;
    }

    const { name, price_mode, options } = result.input;

    const images: PendingImages['options'] = form.options.flatMap((option, index) =>
      option.imageChange ? [{ group: 0, option: index, change: option.imageChange }] : []
    );

    update.mutate(
      { id: props.group.id, input: { name, price_mode, options } },
      {
        onSuccess: ({ group }) =>
          images.length ? saveImages.mutate({ group, images }, { onSuccess: props.onDone }) : props.onDone()
      }
    );
  };

  const error = update.error ?? saveImages.error;

  return (
    <div className="flex flex-col gap-3">
      <GroupEditor group={form} onChange={setForm} limits={false} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={saving || !!invalid}
          onClick={save}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar em todos'}
        </button>
        <button type="button" onClick={props.onDone} className="text-sm text-muted hover:text-fg">
          Cancelar
        </button>
        {invalid && <span className="text-sm text-warn-fg">{invalid}</span>}
        {!invalid && error != null && <span className="text-sm text-danger-fg">{errorText(error)}</span>}
      </div>
    </div>
  );
}
