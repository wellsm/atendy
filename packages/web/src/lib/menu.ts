import type { MenuProduct } from './queries';

import { formatMoney } from './format';

type RuleGroup = {
  name: string;
  min: number;
  price_mode: string;
  options: { price_delta_cents: number; active: boolean }[];
};

/**
 * Groups that need more active options than they have. The agent treats such a product as unavailable
 * (same rule as `priceItem` in the API).
 */
export const unavailableGroups = (groups: RuleGroup[]) =>
  groups
    .filter(({ min, options }) => options.filter(({ active }) => active).length < min)
    .map(({ name, min }) => ({ name, needed: min }));

export const unavailableText = (groups: RuleGroup[]) =>
  unavailableGroups(groups)
    .map(
      ({ name, needed }) =>
        `${name || 'grupo sem nome'} precisa de ${needed} ${needed === 1 ? 'opção ativa' : 'opções ativas'}`
    )
    .join('; ');

/**
 * Base price, or "a partir de" the cheapest valid choice when required groups add to it.
 */
export const priceLabel = (product: Pick<MenuProduct, 'price_cents'> & { groups: RuleGroup[] }) => {
  let extra = 0;

  for (const group of product.groups) {
    const cheapest = group.options
      .filter(({ active }) => active)
      .map(({ price_delta_cents }) => price_delta_cents)
      .sort((a, b) => a - b)
      .slice(0, group.min);

    if (!group.min || cheapest.length < group.min) {
      continue;
    }

    extra += group.price_mode === 'max' ? Math.max(...cheapest) : cheapest.reduce((total, delta) => total + delta, 0);
  }

  return extra ? `a partir de ${formatMoney(product.price_cents + extra)}` : formatMoney(product.price_cents);
};
