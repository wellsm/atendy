import type { StorePolicy } from './types';

export const DEFAULT_ORDER_MEMORY_HOURS = 3;

export const SOP_MAX_LENGTH = 2000;

const LIMIT_KEYS = [
  'max_item_qty',
  'max_order_cents',
  'max_change_cents',
  'min_order_cents',
  'new_customer_review_cents',
  'last_order_minutes',
  'order_memory_hours'
] as const;

type LimitKey = (typeof LIMIT_KEYS)[number];

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
