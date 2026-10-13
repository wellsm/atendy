import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AdminProvider } from '../provider';
import type { AdminIdentity, AdminStore } from '../types';

import { StoreRepository } from '../../stores/repository';
import { toAdminStore } from '../types';

export declare class ListStoresRequest implements Http.Request {
  identity: AdminIdentity;
}

export declare class ListStoresResponse implements Http.Response {
  status: 200;
  body: {
    stores: AdminStore[];
  };
}

export async function listStoresHandler(
  _request: Http.Incoming<ListStoresRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ListStoresResponse> {
  const stores = await StoreRepository.listForAdmin(db);

  return { status: 200, body: { stores: stores.map(toAdminStore) } };
}
