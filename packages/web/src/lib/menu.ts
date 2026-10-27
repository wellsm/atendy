import type { MenuProduct } from './queries';

import { formatMoney } from './format';

type RuleGroup = {
  name: string;
  min: number;
  price_mode: string;
  options: { price_delta_cents: number; active: boolean; sold_out?: boolean }[];
};

/**
 * Orderable: on and with stock. Sold out is not inactive (the store did not turn it off), so keep the wording apart.
 */
export const isAvailable = ({ active, sold_out }: { active: boolean; sold_out?: boolean }) => active && !sold_out;

/**
 * Groups that need more active options than they have. The agent treats such a product as unavailable
 * (same rule as `priceItem` in the API).
 */
export const unavailableGroups = (groups: RuleGroup[]) =>
  groups
    .filter(({ min, options }) => options.filter(isAvailable).length < min)
    .map(({ name, min, options }) => ({
      name,
      needed: min,
      // Short only because stock ran out: enough options are still turned on.
      soldOutOnly: options.filter(({ active }) => active).length >= min
    }));

export const unavailableText = (groups: RuleGroup[]) =>
  unavailableGroups(groups)
    .map(
      ({ name, needed }) =>
        `${name || 'grupo sem nome'} precisa de ${needed} ${needed === 1 ? 'opção disponível' : 'opções disponíveis'}`
    )
    .join('; ');

/**
 * Cheapest valid price: the base plus the cheapest choice of each required group (`from` when that adds to the base).
 */
export const startingPrice = (product: Pick<MenuProduct, 'price_cents'> & { groups: RuleGroup[] }) => {
  let extra = 0;

  for (const group of product.groups) {
    const cheapest = group.options
      .filter(isAvailable)
      .map(({ price_delta_cents }) => price_delta_cents)
      .sort((a, b) => a - b)
      .slice(0, group.min);

    if (!group.min || cheapest.length < group.min) {
      continue;
    }

    extra += group.price_mode === 'max' ? Math.max(...cheapest) : cheapest.reduce((total, delta) => total + delta, 0);
  }

  return { cents: product.price_cents + extra, from: extra > 0 };
};

/**
 * Base price, or "a partir de" the cheapest valid choice when required groups add to it.
 */
export const priceLabel = (product: Pick<MenuProduct, 'price_cents'> & { groups: RuleGroup[] }) => {
  const { cents, from } = startingPrice(product);

  return from ? `a partir de ${formatMoney(cents)}` : formatMoney(cents);
};
