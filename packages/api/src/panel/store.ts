import type { DbClient } from '../db';
import type { PanelIdentity, PanelStore } from './types';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';

import { toPanelStore } from './types';
import { MenuError } from '../menu/validation';
import { isStoreOpen } from '../stores/hours';
import { StoreRepository } from '../stores/repository';
import { SettingsError } from '../stores/settings';

/**
 * The store of the token org. Every operations endpoint scopes its queries by this store id.
 */
export const requireStore = async (db: DbClient, identity: PanelIdentity) => {
  const store = identity.orgId && (await StoreRepository.findByOrgId(db, identity.orgId));

  if (!store) {
    throw new HttpNotFoundError('Store not found');
  }

  return store;
};

/**
 * The store as the panel shows it, with `openNow` from its hours.
 */
export const loadPanelStore = async (
  db: DbClient,
  store: Parameters<typeof toPanelStore>[0] & { timezone: string }
): Promise<PanelStore> => {
  const hours = await StoreRepository.getHours(db, store.id);

  return toPanelStore(store, isStoreOpen(hours, store.timezone, new Date()));
};

/**
 * Runs a settings write; a `SettingsError` becomes a 400 whose context names the field to fix.
 */
export const withSettingsErrors = async <T>(write: () => T | Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof SettingsError) {
      throw new HttpBadRequestError(error.message, { field: error.field });
    }

    throw error;
  }
};

/**
 * Runs a menu write; a `MenuError` becomes a 400 whose context names the field to fix.
 */
export const withMenuErrors = async <T>(write: () => T | Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof MenuError) {
      throw new HttpBadRequestError(error.message, { field: error.field });
    }

    throw error;
  }
};
