import type { OptionsSnapshot } from './types';

import { PriceMode } from '../menu/types';

export const enum PricingErrorCode {
  ProductInactive = 'product_inactive',
  UnknownGroup = 'unknown_group',
  DuplicateGroup = 'duplicate_group',
  UnknownOption = 'unknown_option',
  OptionInactive = 'option_inactive',
  DuplicateOption = 'duplicate_option',
  BelowMin = 'below_min',
  AboveMax = 'above_max',
  ChangeBelowTotal = 'change_below_total'
}

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type PricingOption = {
  id: string;
  name: string;
  price_delta_cents: number;
  active: boolean;
};

export type PricingGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  price_mode: PriceMode;
  options: PricingOption[];
};

export type PricingProduct = {
  id: string;
  name: string;
  price_cents: number;
  active: boolean;
  groups: PricingGroup[];
};

export type Selection = {
  group_id: string;
  option_ids: string[];
};

/**
 * Price one unit of a product with the selected options and build the snapshot stored on the order item.
 * Throws `PricingError` when the selection is not valid for the product.
 */
export const priceItem = (product: PricingProduct, selections: Selection[]) => {
  if (!product.active) {
    throw new PricingError(PricingErrorCode.ProductInactive, `${product.name} is not available`);
  }

  for (const group of product.groups) {
    if (group.options.filter(({ active }) => active).length < group.min) {
      throw new PricingError(PricingErrorCode.ProductInactive, `${product.name} is not available`);
    }
  }

  const groupIds = new Set<string>();

  for (const selection of selections) {
    if (!product.groups.some(({ id }) => id === selection.group_id)) {
      throw new PricingError(PricingErrorCode.UnknownGroup, `Unknown group ${selection.group_id}`);
    }

    if (groupIds.has(selection.group_id)) {
      throw new PricingError(PricingErrorCode.DuplicateGroup, `Group ${selection.group_id} sent more than once`);
    }

    groupIds.add(selection.group_id);
  }

  let unitPriceCents = product.price_cents;

  const optionsSnapshot: OptionsSnapshot = [];

  for (const group of product.groups) {
    const optionIds = selections.find(({ group_id }) => group_id === group.id)?.option_ids ?? [];

    const chosen = pickOptions(group, optionIds);

    if (!chosen.length) {
      continue;
    }

    const deltas = chosen.map(({ price_delta_cents }) => price_delta_cents);

    unitPriceCents +=
      group.price_mode === PriceMode.Max ? Math.max(...deltas) : deltas.reduce((total, delta) => total + delta, 0);

    optionsSnapshot.push({
      group_id: group.id,
      group_name: group.name,
      options: chosen.map(({ id, name, price_delta_cents }) => ({ id, name, price_delta_cents }))
    });
  }

  return {
    unit_price_cents: unitPriceCents,
    options_snapshot: optionsSnapshot
  };
};

const pickOptions = (group: PricingGroup, optionIds: string[]) => {
  if (new Set(optionIds).size !== optionIds.length) {
    throw new PricingError(PricingErrorCode.DuplicateOption, `Repeated option in ${group.name}`);
  }

  if (optionIds.length < group.min) {
    throw new PricingError(PricingErrorCode.BelowMin, `${group.name} needs at least ${group.min}`);
  }

  if (optionIds.length > group.max) {
    throw new PricingError(PricingErrorCode.AboveMax, `${group.name} allows at most ${group.max}`);
  }

  return optionIds.map((optionId) => {
    const option = group.options.find(({ id }) => id === optionId);

    if (!option) {
      throw new PricingError(PricingErrorCode.UnknownOption, `Unknown option ${optionId} in ${group.name}`);
    }

    if (!option.active) {
      throw new PricingError(PricingErrorCode.OptionInactive, `${option.name} is not available`);
    }

    return option;
  });
};

export const computeTotals = (items: { qty: number; unit_price_cents: number }[], feeCents: number) => {
  const subtotalCents = items.reduce((total, { qty, unit_price_cents }) => total + qty * unit_price_cents, 0);

  return {
    subtotal_cents: subtotalCents,
    fee_cents: feeCents,
    total_cents: subtotalCents + feeCents
  };
};

/**
 * Cash change must cover the order total. `null`/`undefined` means no change needed.
 */
export const validateChange = (totalCents: number, changeForCents: number | null | undefined) => {
  if (changeForCents === null || changeForCents === undefined) {
    return;
  }

  if (changeForCents < totalCents) {
    throw new PricingError(PricingErrorCode.ChangeBelowTotal, 'Change amount is below the order total');
  }
};
