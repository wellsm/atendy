import { normalizeText } from './search';
import { PriceMode } from './types';

/**
 * R$ 100.000: catches typos before they overflow the integer columns.
 */
export const MAX_PRICE_CENTS = 10_000_000;

export const MAX_CATEGORIES = 50;

export const MAX_GROUPS = 10;

export const MAX_OPTIONS = 100;

export const MAX_NAME_LENGTH = 80;

export const MAX_DESCRIPTION_LENGTH = 300;

/**
 * A menu value the store must fix. `field` is the wire name the panel highlights.
 */
export class MenuError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * `active` absent on an existing option keeps the stored value (a sold-out toggle made while the form was open);
 * a new option without it starts active. Same for the product.
 */
export type OptionDraft = {
  id?: string;
  name: string;
  priceDeltaCents: number;
  active?: boolean;
};

export type GroupDraft = {
  id?: string;
  name: string;
  min: number;
  max: number;
  priceMode: PriceMode;
  options: OptionDraft[];
};

export type ProductDraft = {
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  active?: boolean;
  groups: GroupDraft[];
};

const PRICE_MODES: string[] = [PriceMode.Sum, PriceMode.Max];

const isPrice = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_PRICE_CENTS;

const cleanName = (value: string, field: string, label: string) => {
  const name = value.trim().replace(/\s+/g, ' ');

  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new MenuError(field, `${label} needs 1 to ${MAX_NAME_LENGTH} characters.`);
  }

  return name;
};

export const validateCategoryName = (name: string) => {
  return cleanName(name, 'name', 'The category name');
};

const validateOptions = (group: GroupDraft, groupName: string) => {
  const seen = new Set<string>();

  return group.options.map((option) => {
    const name = cleanName(option.name, 'options', `Options of ${groupName}`);

    if (!isPrice(option.priceDeltaCents)) {
      throw new MenuError('options', `Prices in ${groupName} must be between zero and R$ 100.000.`);
    }

    const key = normalizeText(name);

    if (seen.has(key)) {
      throw new MenuError('options', `Option repeated in ${groupName}: ${name}.`);
    }

    seen.add(key);

    return {
      ...(option.id !== undefined && { id: option.id }),
      name,
      priceDeltaCents: option.priceDeltaCents,
      ...(option.active !== undefined && { active: option.active })
    };
  });
};

const validateGroup = (group: GroupDraft): GroupDraft => {
  const name = cleanName(group.name, 'groups', 'Group names');

  if (!group.options.length || group.options.length > MAX_OPTIONS) {
    throw new MenuError('groups', `${name} needs 1 to ${MAX_OPTIONS} options.`);
  }

  if (!PRICE_MODES.includes(group.priceMode)) {
    throw new MenuError('groups', `${name} has an unknown price mode.`);
  }

  const { min, max } = group;

  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max) {
    throw new MenuError('groups', `${name}: choose from a minimum to a maximum, with the maximum at least 1.`);
  }

  if (max > group.options.length) {
    throw new MenuError('groups', `${name}: the maximum is higher than the number of options.`);
  }

  return {
    ...(group.id !== undefined && { id: group.id }),
    name,
    min,
    max,
    priceMode: group.priceMode,
    options: validateOptions(group, name)
  };
};

/**
 * Sent ids must be unique across the product; ownership is checked by the repository.
 */
const assertUniqueIds = (groups: GroupDraft[]) => {
  const groupIds = new Set<string>();
  const optionIds = new Set<string>();

  const add = (ids: Set<string>, id: string | undefined) => {
    if (id === undefined) {
      return;
    }

    if (ids.has(id)) {
      throw new MenuError('ids', 'The same id was sent twice.');
    }

    ids.add(id);
  };

  for (const group of groups) {
    add(groupIds, group.id);

    for (const option of group.options) {
      add(optionIds, option.id);
    }
  }
};

/**
 * Valid product with groups and options, names cleaned. Order of groups and options is kept.
 */
export const validateProduct = (input: ProductDraft): ProductDraft => {
  const name = cleanName(input.name, 'name', 'The product name');
  const description = input.description?.trim() || null;

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new MenuError('description', `The description can have at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  if (!isPrice(input.priceCents)) {
    throw new MenuError('price_cents', 'The price must be between zero and R$ 100.000.');
  }

  if (input.groups.length > MAX_GROUPS) {
    throw new MenuError('groups', `At most ${MAX_GROUPS} groups.`);
  }

  const groups = input.groups.map(validateGroup);

  assertUniqueIds(groups);

  return {
    categoryId: input.categoryId,
    name,
    description,
    priceCents: input.priceCents,
    ...(input.active !== undefined && { active: input.active }),
    groups
  };
};
