import type { HourRange } from './hours';
import type { PaymentMethod, StorePolicy } from './types';

import { normalizeNeighborhood } from './delivery';
import { parsePolicyPatch, PolicyError } from './policy';
import { DeliveryMode } from './types';

export const MAX_HOUR_RANGES = 28;

export const MAX_DELIVERY_ZONES = 200;

export const MAX_NAME_LENGTH = 80;

const DAY_MINUTES = 24 * 60;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Policy keys the store edits in the panel. `order_memory_hours` stays admin-only.
 */
export const PANEL_POLICY_KEYS = [
  'min_order_cents',
  'max_order_cents',
  'max_change_cents',
  'max_item_qty',
  'new_customer_review_cents',
  'last_order_minutes',
  'sop'
] as const;

/**
 * A settings value the store must fix. `field` is the wire name the panel highlights.
 */
export class SettingsError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
  }
}

export type DeliverySettings = {
  mode: DeliveryMode;
  flatFeeCents: number;
  zones: { neighborhood: string; feeCents: number }[];
};

const isCents = (value: number) => Number.isInteger(value) && value >= 0;

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return hours * 60 + minutes;
};

/**
 * Part of a range inside its own weekday: an overnight range ends at midnight, a 24 h range (`opens == closes`)
 * covers the rest of the day. The next-day part never overlaps the next weekday's ranges in practice, and the
 * agent treats the union anyway.
 */
const sameDayInterval = (range: HourRange) => {
  const opens = toMinutes(range.opens_at);
  const closes = toMinutes(range.closes_at);

  return { start: opens, end: closes > opens ? closes : DAY_MINUTES };
};

const compareRanges = (a: HourRange, b: HourRange) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at);

/**
 * Valid week of opening ranges, sorted by weekday and opening time.
 */
export const validateHours = (hours: HourRange[]) => {
  if (hours.length > MAX_HOUR_RANGES) {
    throw new SettingsError('hours', `At most ${MAX_HOUR_RANGES} ranges.`);
  }

  for (const range of hours) {
    if (!Number.isInteger(range.weekday) || range.weekday < 0 || range.weekday > 6) {
      throw new SettingsError('hours', 'Weekday must be 0 (Sunday) to 6 (Saturday).');
    }

    if (!TIME_PATTERN.test(range.opens_at) || !TIME_PATTERN.test(range.closes_at)) {
      throw new SettingsError('hours', 'Times must be HH:MM.');
    }
  }

  const sorted = [...hours].sort(compareRanges);

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;

    if (previous.weekday === current.weekday && sameDayInterval(current).start < sameDayInterval(previous).end) {
      throw new SettingsError('hours', 'Ranges of the same day overlap.');
    }
  }

  return sorted;
};

/**
 * Valid delivery settings. Flat mode keeps no zones; by-zone mode needs at least one, unique after normalizing.
 */
export const validateDelivery = (input: DeliverySettings): DeliverySettings => {
  if (!isCents(input.flatFeeCents)) {
    throw new SettingsError('flat_fee_cents', 'The delivery fee must be zero or more.');
  }

  if (input.mode === DeliveryMode.Flat) {
    return { mode: input.mode, flatFeeCents: input.flatFeeCents, zones: [] };
  }

  if (!input.zones.length) {
    throw new SettingsError('zones', 'Add at least one neighborhood.');
  }

  if (input.zones.length > MAX_DELIVERY_ZONES) {
    throw new SettingsError('zones', `At most ${MAX_DELIVERY_ZONES} neighborhoods.`);
  }

  const seen = new Set<string>();

  const zones = input.zones.map((zone) => {
    const neighborhood = zone.neighborhood.trim().replace(/\s+/g, ' ');

    if (!neighborhood || neighborhood.length > MAX_NAME_LENGTH) {
      throw new SettingsError('zones', `Neighborhood names need 1 to ${MAX_NAME_LENGTH} characters.`);
    }

    if (!isCents(zone.feeCents)) {
      throw new SettingsError('zones', 'Neighborhood fees must be zero or more.');
    }

    const key = normalizeNeighborhood(neighborhood);

    if (seen.has(key)) {
      throw new SettingsError('zones', `Neighborhood repeated: ${neighborhood}.`);
    }

    seen.add(key);

    return { neighborhood, feeCents: zone.feeCents };
  });

  return { mode: input.mode, flatFeeCents: input.flatFeeCents, zones };
};

export const validatePaymentMethods = (methods: PaymentMethod[]) => {
  if (!methods.length) {
    throw new SettingsError('payment_methods', 'Choose at least one payment method.');
  }

  return [...new Set(methods)];
};

export const validateStoreName = (name: string) => {
  const trimmed = name.trim();

  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
    throw new SettingsError('name', `The store name needs 1 to ${MAX_NAME_LENGTH} characters.`);
  }

  return trimmed;
};

/**
 * Policy patch from the panel: only `PANEL_POLICY_KEYS`, same value rules as the admin script.
 */
export const validatePanelPolicy = (patch: Record<string, unknown>): StorePolicy => {
  const valid: StorePolicy = {};

  for (const [key, value] of Object.entries(patch)) {
    if (!(PANEL_POLICY_KEYS as readonly string[]).includes(key)) {
      throw new SettingsError(key, `${key} cannot be changed in the panel.`);
    }

    try {
      Object.assign(valid, parsePolicyPatch(JSON.stringify({ [key]: value })));
    } catch (error) {
      if (error instanceof PolicyError) {
        throw new SettingsError(key, error.message);
      }

      throw error;
    }
  }

  return valid;
};
