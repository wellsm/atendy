import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { StoreRepository } from '../../stores/repository';
import { validateStoreName } from '../../stores/settings';
import { loadPanelStore, requireStore, withSettingsErrors } from '../store';

export declare class UpdateStoreRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    name?: string;
    acceptingOrders?: boolean;
  };
}

export declare class UpdateStoreResponse implements Http.Response {
  status: 200;
  body: {
    store: PanelStore;
  };
}

/**
 * Store name and the "Aceitando pedidos" switch.
 */
export async function updateStoreHandler(
  request: Http.Incoming<UpdateStoreRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateStoreResponse> {
  const store = await requireStore(db, request.identity);
  const { name, acceptingOrders } = request.body;

  if (name === undefined && acceptingOrders === undefined) {
    throw new HttpBadRequestError('Nothing to update.');
  }

  const input = await withSettingsErrors(() => ({
    name: name === undefined ? undefined : validateStoreName(name),
    acceptingOrders
  }));

  await StoreRepository.updateStore(db, store.id, input);

  return {
    status: 200,
    body: {
      store: await loadPanelStore(db, {
        ...store,
        ...(input.name !== undefined && { name: input.name }),
        ...(acceptingOrders !== undefined && { accepting_orders: acceptingOrders })
      })
    }
  };
}
