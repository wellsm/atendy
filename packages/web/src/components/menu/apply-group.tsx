import type { ApplyGroupResult } from '../../lib/queries';

import { useState } from 'react';

import { Stepper } from './group-editor';
import { useApplyGroup } from '../../lib/queries';

export type ApplyTarget = {
  id: string;
  name: string;
  /**
   * Already has a group with this name: the API would skip it.
   */
  hasGroup: boolean;
};

export type ApplyCategory = { id: string; name: string; products: ApplyTarget[] };

const count = (total: number, one: string, many: string) => `${total} ${total === 1 ? one : many}`;

const resultText = ({ applied, already_had, full }: ApplyGroupResult) =>
  [
    `Aplicado em ${count(applied.length, 'produto', 'produtos')}`,
    already_had.length > 0 && `${count(already_had.length, 'já tinha', 'já tinham')} esse grupo`,
    full.length > 0 && `${count(full.length, 'está', 'estão')} no limite de grupos`
  ]
    .filter(Boolean)
    .join('; ') + '.';

/**
 * Links a saved group to the products picked here, by category, with the "escolhe de … a …" chosen here (it starts
 * with `min`/`max`). Name, options and prices stay shared.
 */
export function ApplyGroup(props: {
  groupId: string;
  groupName: string;
  optionCount: number;
  min: number;
  max: number;
  categories: ApplyCategory[];
  onClose: () => void;
}) {
  const apply = useApplyGroup();
  const [selected, setSelected] = useState<string[]>([]);
  const [limits, setLimits] = useState({ min: props.min, max: props.max });
  const categories = props.categories.filter(({ products }) => products.length > 0);

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const toggleCategory = (category: ApplyCategory) => {
    const ids = category.products.filter(({ hasGroup }) => !hasGroup).map(({ id }) => id);
    const all = ids.every((id) => selected.includes(id));

    setSelected((current) =>
      all ? current.filter((id) => !ids.includes(id)) : [...current, ...ids.filter((id) => !current.includes(id))]
    );
  };

  const submit = () =>
    apply.mutate({ groupId: props.groupId, productIds: selected, ...limits }, { onSuccess: () => setSelected([]) });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          Aplicar <strong>{props.groupName}</strong> em outros produtos. O grupo fica compartilhado: nome, opções e
          preços mudam em todos de uma vez.
        </p>
        <button type="button" onClick={props.onClose} className="text-sm text-muted hover:text-fg">
          Fechar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
        Nesses produtos, cliente escolhe de
        <Stepper
          value={limits.min}
          label="mínimo"
          onDec={limits.min > 0 ? () => setLimits({ ...limits, min: limits.min - 1 }) : undefined}
          onInc={
            limits.min < props.optionCount
              ? () => setLimits({ min: limits.min + 1, max: Math.max(limits.max, limits.min + 1) })
              : undefined
          }
        />
        a
        <Stepper
          value={limits.max}
          label="máximo"
          onDec={
            limits.max > 1
              ? () => setLimits({ max: limits.max - 1, min: Math.min(limits.min, limits.max - 1) })
              : undefined
          }
          onInc={limits.max < props.optionCount ? () => setLimits({ ...limits, max: limits.max + 1 }) : undefined}
        />
      </div>

      {!categories.length && <p className="text-sm text-muted">Não há outros produtos no cardápio.</p>}

      {categories.map((category) => {
        const available = category.products.filter(({ hasGroup }) => !hasGroup);
        const all = available.length > 0 && available.every(({ id }) => selected.includes(id));

        return (
          <div key={category.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{category.name}</span>
              {available.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="text-xs font-medium text-accent-fg"
                >
                  {all ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {category.products.map((product) => {
                const checked = selected.includes(product.id);

                return (
                  <label
                    key={product.id}
                    title={product.hasGroup ? 'Já tem um grupo com esse nome' : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
                      product.hasGroup
                        ? 'cursor-not-allowed border-line text-faint'
                        : checked
                          ? 'cursor-pointer border-accent bg-accent-soft text-accent-fg'
                          : 'cursor-pointer border-line-2 text-fg-2'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={product.hasGroup}
                      onChange={() => toggle(product.id)}
                      className="sr-only"
                    />
                    {product.name}
                    {product.hasGroup && ' · já tem'}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={!selected.length || apply.isPending}
          onClick={submit}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {apply.isPending ? 'Aplicando…' : `Aplicar em ${count(selected.length, 'produto', 'produtos')}`}
        </button>

        {apply.isSuccess && <span className="text-sm text-fg-2">{resultText(apply.data)}</span>}

        {apply.isError && (
          <span className="text-sm text-danger-fg">
            Não foi possível aplicar. Recarregue o cardápio e tente de novo.
          </span>
        )}
      </div>
    </div>
  );
}
