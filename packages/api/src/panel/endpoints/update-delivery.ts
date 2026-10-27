import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelDelivery, PanelIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { StoreRepository } from '../../stores/repository';
import { validateDelivery } from '../../stores/settings';
import { DeliveryMode } from '../../stores/types';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdateDeliveryRequest implements Http.Request {
  identity: PanelIdentity;
  body: PanelDelivery;
}

export declare class UpdateDeliveryResponse implements Http.Response {
  status: 200;
  body: {
    delivery: PanelDelivery;
  };
}

/**
 * Flat fee, neighborhood list or distance bands; only the list of the chosen mode is kept.
 */
export async function updateDeliveryHandler(
  request: Http.Incoming<UpdateDeliveryRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateDeliveryResponse> {
  const store = await requireStore(db, request.identity);
  const delivery = await withSettingsErrors(() => validateDelivery(request.body));

  if (delivery.mode === DeliveryMode.ByDistance && !(await StoreRepository.getStoreLocation(db, store.id))) {
    throw new HttpBadRequestError('Locate the store address before delivering by distance.', {
      field: 'store_location'
    });
  }

  await StoreRepository.replaceDelivery(db, store.id, delivery);

  return { status: 200, body: { delivery } };
}
