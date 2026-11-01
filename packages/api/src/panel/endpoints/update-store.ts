import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validateStoreName } from '../../stores/settings';
import { loadPanelStore, requireStore, withSettingsErrors } from '../store';

export declare class UpdateStoreRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateStoreResponse> {
  const store = await requireStore(db, request.identity);
  const { name, acceptingOrders } = request.body;

  // Pausing orders alone is a board action; the name stays a setting.
  await authorize(
    db,
    store,
    request.identity,
    request.headers,
    name === undefined ? Permission.OrdersBoard : Permission.Settings
  );

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
