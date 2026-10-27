import type { DbClient } from '../db';
import type { AdminStoreDetail } from './types';

import { HttpNotFoundError } from '@ez4/gateway';

import { toAdminStore } from './types';
import { DEFAULT_ORDER_PRICE_CENTS, DEFAULT_WEB_ORDER_PERCENT } from '../billing/progress';
import { PaymentsRepository } from '../payments/repository';
import { isStoreOpen } from '../stores/hours';
import { LLM_MODELS } from '../stores/models';
import { StoreRepository } from '../stores/repository';
import { OrderCodeMode } from '../stores/types';

/**
 * A store of any org, for admin routes; 404 when unknown.
 */
export const requireAdminStore = async (db: DbClient, storeId: string) => {
  const store = await StoreRepository.getAdminStore(db, storeId);

  if (!store) {
    throw new HttpNotFoundError('Store not found.');
  }

  return store;
};

/**
 * Store, health and technical settings for the admin detail page.
 */
export const loadAdminDetail = async (db: DbClient, storeId: string): Promise<AdminStoreDetail> => {
  const store = await requireAdminStore(db, storeId);

  const [health, hours, billing] = await Promise.all([
    StoreRepository.getHealth(db, storeId),
    StoreRepository.getHours(db, storeId),
    PaymentsRepository.summary(db, storeId)
  ]);

  return {
    store: toAdminStore(store),
    health: {
      ...health,
      openNow: isStoreOpen(hours, store.timezone, new Date()),
      acceptingOrders: store.accepting_orders
    },
    orderMemoryHours: store.policy?.order_memory_hours ?? null,
    orderPriceCents: store.order_price_cents ?? null,
    defaultOrderPriceCents: DEFAULT_ORDER_PRICE_CENTS,
    webOrderPercent: store.web_order_percent ?? null,
    defaultWebOrderPercent: DEFAULT_WEB_ORDER_PERCENT,
    orderCodeMode: store.order_code_mode ?? OrderCodeMode.Random,
    models: [...LLM_MODELS],
    billing: billing ?? null
  };
};
