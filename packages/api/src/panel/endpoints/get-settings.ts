import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PaymentMethod } from '../../stores/types';
import type { PanelProvider } from '../provider';
import type { PanelDelivery, PanelHourRange, PanelIdentity, PanelPolicy } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { StoreRepository } from '../../stores/repository';
import { requireStore } from '../store';
import { toPanelHours, toPanelPolicy } from '../types';

export declare class GetSettingsRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetSettingsResponse implements Http.Response {
  status: 200;
  body: {
    hours: PanelHourRange[];
    delivery: PanelDelivery;
    paymentMethods: PaymentMethod[];
    policy: PanelPolicy;
  };
}

export async function getSettingsHandler(
  request: Http.Incoming<GetSettingsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetSettingsResponse> {
  const store = await requireStore(db, request.identity);
  const settings = await StoreRepository.getSettings(db, store.id);

  if (!settings) {
    throw new HttpNotFoundError('Store not found');
  }

  return {
    status: 200,
    body: {
      hours: toPanelHours(settings.hours),
      delivery: settings.delivery,
      paymentMethods: settings.paymentMethods,
      policy: toPanelPolicy(settings.policy)
    }
  };
}
