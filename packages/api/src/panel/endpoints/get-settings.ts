import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PaymentMethod, PosSettings } from '../../stores/types';
import type { PanelProvider } from '../provider';
import type { PanelDelivery, PanelHourRange, PanelIdentity, PanelPolicy, PanelStoreLocation } from '../types';

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
    /**
     * Null until the store located its address (needed for distance delivery).
     */
    storeLocation: PanelStoreLocation | null;
    /**
     * Daily low-stock WhatsApp digest: digits phone and local hour; null = off / default hour (9).
     */
    stockAlertPhone: string | null;
    stockAlertHour: number | null;
    pos: PosSettings;
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
      policy: toPanelPolicy(settings.policy),
      storeLocation: settings.storeLocation,
      stockAlertPhone: settings.stockAlertPhone,
      stockAlertHour: settings.stockAlertHour,
      pos: settings.pos
    }
  };
}
