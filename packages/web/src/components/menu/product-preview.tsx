import type { PriceMode } from '../../lib/queries';

import { priceLabel } from '../../lib/menu';

type PreviewGroup = {
  key: string;
  name: string;
  min: number;
  max: number;
  price_mode: PriceMode;
  options: { price_delta_cents: number; active: boolean }[];
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const ruleText = ({ min, max, price_mode }: PreviewGroup) => {
  const rule =
    min === 0
      ? `Até ${plural(max, 'opção', 'opções')}`
      : min === max
        ? `Escolha ${plural(min, 'opção', 'opções')}`
        : `Escolha de ${min} a ${max}`;

  return price_mode === 'max' && max > 1 ? `${rule} · cobra a mais cara` : rule;
};

/**
 * Live card of the product as the customer sees it, plus what blocks the save or the bot.
 */
export function ProductPreview(props: {
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  active: boolean;
  groups: PreviewGroup[];
  unavailable: string;
  invalid?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">Como o cliente vê</span>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className={`flex gap-3 p-4 ${props.active ? '' : 'opacity-50'}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="break-words font-semibold">{props.name.trim() || 'Nome do produto'}</span>
            {props.description.trim() && <span className="line-clamp-2 text-sm text-muted">{props.description}</span>}
            <span className="mt-1 font-semibold">
              {priceLabel({ price_cents: props.priceCents, groups: props.groups })}
            </span>
          </div>
          {props.imageUrl && (
            <img src={props.imageUrl} alt="" className="size-22 shrink-0 rounded-[10px] bg-surface-2 object-cover" />
          )}
        </div>

        {props.groups.map((group) => (
          <div key={group.key} className="flex justify-between gap-2 border-t border-line bg-hover px-4 py-2.5 text-sm">
            <span className="flex min-w-0 flex-col">
              <b className="break-words font-semibold">{group.name.trim() || 'Grupo sem nome'}</b>
              <span className="text-xs text-muted">{ruleText(group)}</span>
            </span>
            <span className="shrink-0 self-center text-xs text-muted">
              {group.options.filter(({ active }) => active).length} de {group.options.length} ativas
            </span>
          </div>
        ))}
      </div>

      {props.unavailable && (
        <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
          Indisponível para o bot: {props.unavailable}.
        </p>
      )}
      {props.invalid && (
        <p className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn-fg">
          {props.invalid}
        </p>
      )}
      {!props.invalid && !props.unavailable && (
        <p className="rounded-lg border border-ok-bg bg-ok-bg px-3 py-2.5 text-sm text-ok-fg">
          Tudo certo para salvar.
        </p>
      )}
    </div>
  );
}
