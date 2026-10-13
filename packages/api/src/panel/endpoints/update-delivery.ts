import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelDelivery, PanelIdentity } from '../types';

import { StoreRepository } from '../../stores/repository';
import { validateDelivery } from '../../stores/settings';
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
 * Flat fee or neighborhood list. Flat mode drops the list.
 */
export async function updateDeliveryHandler(
  request: Http.Incoming<UpdateDeliveryRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateDeliveryResponse> {
  const store = await requireStore(db, request.identity);
  const delivery = await withSettingsErrors(() => validateDelivery(request.body));

  await StoreRepository.replaceDelivery(db, store.id, delivery);

  return { status: 200, body: { delivery } };
}
