import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminProvider } from '../provider';
import type { AdminIdentity, AdminStore } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { StoreRepository } from '../../stores/repository';
import { toAdminStore } from '../types';

export declare class UpdateStoreRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
  body: {
    active: boolean;
  };
}

export declare class UpdateStoreResponse implements Http.Response {
  status: 200;
  body: {
    store: AdminStore;
  };
}

/**
 * Activates (or suspends) a store. An inactive store gets no WhatsApp processing.
 */
export async function updateStoreHandler(
  request: Http.Incoming<UpdateStoreRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<UpdateStoreResponse> {
  const store = await StoreRepository.setActive(db, request.parameters.storeId, request.body.active);

  if (!store) {
    throw new HttpNotFoundError('Store not found.');
  }

  return { status: 200, body: { store: toAdminStore(store) } };
}
