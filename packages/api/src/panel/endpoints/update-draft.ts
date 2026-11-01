import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { Fulfillment } from '../../orders/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PaymentMethod } from '../../stores/types';
import type { PanelDraftProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { OrderRepository } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { locateWithGoogle } from '../../stores/geocoding';
import { requireStaffDraft, withOrderErrors } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class UpdateDraftRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    conversationId: String.UUID;
  };
  /**
   * One change per request: delivery or pickup, a typed address, the saved address, or the payment.
   */
  body: {
    fulfillment?: Fulfillment;
    address?: { address: String.Size<1, 200>; neighborhood?: String.Size<0, 80> | null };
    useSavedAddress?: boolean;
    payment?: { method: PaymentMethod; changeForCents?: Integer.Min<0> | null };
  };
}

export declare class UpdateDraftResponse implements Http.Response {
  status: 200;
  body: {
    cart: PanelCart;
  };
}

/**
 * The attendant sets delivery, address or payment of the draft. Distance delivery geocodes typed addresses like the
 * bot does.
 */
export async function updateDraftHandler(
  request: Http.Incoming<UpdateDraftRequest>,
  { db, panelEvents }: Service.Context<PanelDraftProvider>
): Promise<UpdateDraftResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Conversations);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);
  const { fulfillment, address, useSavedAddress, payment } = request.body;
  const geocode = locateWithGoogle(process.env.GOOGLE_MAPS_API_KEY);

  const cart = await withOrderErrors(async () => {
    if (fulfillment) {
      return OrderRepository.setFulfillment(db, scope, fulfillment);
    }

    if (address) {
      return OrderRepository.setAddress(
        db,
        scope,
        { address: address.address.trim(), neighborhood: address.neighborhood?.trim() || null },
        geocode
      );
    }

    if (useSavedAddress) {
      return OrderRepository.applySavedAddress(db, scope, geocode);
    }

    if (payment) {
      return OrderRepository.setPayment(db, scope, {
        method: payment.method,
        changeForCents: payment.changeForCents ?? null
      });
    }

    throw new HttpBadRequestError('Nothing to change');
  });

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    request.parameters.conversationId
  );

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
