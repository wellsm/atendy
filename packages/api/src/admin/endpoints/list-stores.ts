import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminProvider } from '../provider';
import type { AdminIdentity, AdminStoreRow } from '../types';

import { StoreRepository } from '../../stores/repository';
import { toAdminStore } from '../types';

export declare class ListStoresRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class ListStoresResponse implements Http.Response {
  status: 200;
  body: {
    stores: AdminStoreRow[];
  };
}

/**
 * Every store with its health summary. No Evolution call here (one per store would slow the list down).
 */
export async function listStoresHandler(
  _request: Http.Incoming<ListStoresRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ListStoresResponse> {
  const stores = await StoreRepository.listForAdmin(db);

  const rows = await Promise.all(
    stores.map(async (store) => {
      const { lastMessageAt, errorCount24h } = await StoreRepository.getHealth(db, store.id);

      return { ...toAdminStore(store), lastMessageAt, errorCount24h };
    })
  );

  return { status: 200, body: { stores: rows } };
}
