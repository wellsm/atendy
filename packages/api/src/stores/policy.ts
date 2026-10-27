import type { StorePolicy } from './types';

import { NewOrderAfterStatus, PreviousAddress } from './types';
import { OrderStatus } from '../orders/types';

export const DEFAULT_ORDER_MEMORY_HOURS = 3;

export const SOP_MAX_LENGTH = 2000;

const LIMIT_KEYS = [
  'max_item_qty',
  'max_order_cents',
  'max_change_cents',
  'min_order_cents',
  'new_customer_review_cents',
  'last_order_minutes',
  'order_memory_hours',
  'delivery_min_minutes',
  'delivery_max_minutes',
  'add_on_extra_minutes'
] as const;

type LimitKey = (typeof LIMIT_KEYS)[number];

/**
 * Statuses a previous order can end in for the bot to offer it again (a draft was never an order).
 */
export const REPEATABLE_STATUSES: OrderStatus[] = [
  OrderStatus.Placed,
  OrderStatus.Accepted,
  OrderStatus.Out,
  OrderStatus.Done,
  OrderStatus.Canceled,
  OrderStatus.Abandoned
];

/**
 * Statuses a store may wait for before the customer starts another order.
 */
export const NEW_ORDER_AFTER_STATUSES: string[] = [
  NewOrderAfterStatus.Accepted,
  NewOrderAfterStatus.Out,
  NewOrderAfterStatus.Done
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PREVIOUS_ADDRESS_MODES: string[] = [PreviousAddress.Ask, PreviousAddress.OnRequest];

export class PolicyError extends Error {}

const isLimitKey = (key: string): key is LimitKey => (LIMIT_KEYS as readonly string[]).includes(key);

/**
 * Validates an admin policy patch (JSON text). `null` clears a key.
 */
export const parsePolicyPatch = (raw: string): StorePolicy => {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    throw new PolicyError('POLICY must be valid JSON');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyError('POLICY must be a JSON object');
  }

  const patch: StorePolicy = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'sop') {
      if (entry === null || (typeof entry === 'string' && entry.length <= SOP_MAX_LENGTH)) {
        patch.sop = entry;
        continue;
      }

      throw new PolicyError(`sop must be text with at most ${SOP_MAX_LENGTH} characters, or null`);
    }

    if (key === 'previous_address') {
      if (entry === null || (typeof entry === 'string' && PREVIOUS_ADDRESS_MODES.includes(entry))) {
        patch.previous_address = entry as PreviousAddress | null;
        continue;
      }

      throw new PolicyError(`previous_address must be one of ${PREVIOUS_ADDRESS_MODES.join(', ')}, or null`);
    }

    if (key === 'repeat_order_statuses') {
      const valid =
        Array.isArray(entry) &&
        new Set(entry).size === entry.length &&
        entry.every((status) => REPEATABLE_STATUSES.includes(status as OrderStatus));

      if (entry === null || valid) {
        patch.repeat_order_statuses = entry as OrderStatus[] | null;
        continue;
      }

      throw new PolicyError(`repeat_order_statuses must be a list of ${REPEATABLE_STATUSES.join(', ')}, or null`);
    }

    if (key === 'new_order_after_status') {
      if (entry === null || (typeof entry === 'string' && NEW_ORDER_AFTER_STATUSES.includes(entry))) {
        patch.new_order_after_status = entry as NewOrderAfterStatus | null;
        continue;
      }

      throw new PolicyError(`new_order_after_status must be one of ${NEW_ORDER_AFTER_STATUSES.join(', ')}, or null`);
    }

    if (key === 'add_on_category_ids') {
      const valid =
        Array.isArray(entry) &&
        new Set(entry).size === entry.length &&
        entry.every((id) => typeof id === 'string' && UUID_PATTERN.test(id));

      if (entry === null || valid) {
        patch.add_on_category_ids = entry as string[] | null;
        continue;
      }

      throw new PolicyError('add_on_category_ids must be a list of category ids without repeats, or null');
    }

    if (!isLimitKey(key)) {
      throw new PolicyError(`Unknown policy key: ${key}`);
    }

    if (entry === null || (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)) {
      patch[key] = entry;
      continue;
    }

    throw new PolicyError(`${key} must be an integer >= 0, or null`);
  }

  return patch;
};

/**
 * Start of the window in which the previous order and its messages still count (one thread per order).
 */
export const orderMemorySince = (policy: StorePolicy | null | undefined, now: Date) => {
  const hours = policy?.order_memory_hours ?? DEFAULT_ORDER_MEMORY_HOURS;

  return new Date(now.getTime() - hours * 3_600_000).toISOString();
};
