import type { StorePolicy } from '../stores/types';

import { OrderStatus } from './types';
import { normalizeText } from '../menu/search';
import { NewOrderAfterStatus } from '../stores/types';

const DRINK_WORDS = ['bebida', 'drink', 'refri', 'suco', 'cerveja'];

/**
 * Default add-on categories (`add_on_category_ids` null): the ones named like drinks.
 */
export const isDrinkCategory = (name: string) => {
  const normalized = normalizeText(name);

  return DRINK_WORDS.some((word) => normalized.includes(word));
};

/**
 * Categories the customer may add to an order the store is preparing. Ids of deleted categories drop out.
 */
export const addOnCategories = <T extends { id: string; name: string }>(
  policy: StorePolicy | null | undefined,
  categories: T[]
) => {
  const ids = policy?.add_on_category_ids;

  return categories.filter((category) => (ids ? ids.includes(category.id) : isDrinkCategory(category.name)));
};

/**
 * `new_order_after_status` when the store never chose: one order at a time.
 */
export const DEFAULT_NEW_ORDER_AFTER_STATUS = NewOrderAfterStatus.Done;

const PROGRESS: OrderStatus[] = [OrderStatus.Accepted, OrderStatus.Out, OrderStatus.Done];

/**
 * Whether the customer may start another order while the last one is in `status`. A `placed` order is edited
 * instead; finished ones never block.
 */
export const canStartNewOrder = (status: OrderStatus, policy: StorePolicy | null | undefined) => {
  if (status === OrderStatus.Canceled || status === OrderStatus.Done) {
    return true;
  }

  const reached = PROGRESS.indexOf(status);
  const needed = PROGRESS.indexOf(
    (policy?.new_order_after_status ?? DEFAULT_NEW_ORDER_AFTER_STATUS) as string as OrderStatus
  );

  return reached >= 0 && reached >= needed;
};
