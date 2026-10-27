import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { PaymentMethod } from '../../stores/types';
import type { StorefrontOrderProvider } from '../provider';
import type { WebOrderDeliveryInput, WebOrderItemInput } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { locateWithGoogle } from '../../stores/geocoding';
import { isPhoneVerified, linkVerificationToOrder } from '../phone-code';
import { toWebItems } from '../types';
import { withWebOrderErrors } from '../web-errors';
import { normalizePhone, placeWebOrder, requireOrderingStore, WebOrderError, WebOrderErrorCode } from '../web-order';

export declare class CreateWebOrderRequest implements Http.Request {
  parameters: {
    slug: string;
  };
  body: {
    name: String.Size<1, 80>;
    phone: String.Size<8, 20>;
    items: WebOrderItemInput[];
    delivery: WebOrderDeliveryInput;
    payment: { method: PaymentMethod; changeForCents?: Integer.Min<0> | null };
    /**
     * From the WhatsApp code check (`/phone-codes/verify`), for this phone.
     */
    phoneToken?: string | null;
    /**
     * Honeypot: hidden in the form, only bots fill it.
     */
    website?: string | null;
  };
}

export declare class CreateWebOrderResponse implements Http.Response {
  status: 201;
  body: {
    code: string;
    totalCents: number;
  };
}

/**
 * The customer sends the order from the public menu. It waits for the store to accept it in the panel.
 */
export async function createWebOrderHandler(
  request: Http.Incoming<CreateWebOrderRequest>,
  { db, panelEvents }: Service.Context<StorefrontOrderProvider>
): Promise<CreateWebOrderResponse> {
  const { name, phone, items, delivery, payment, phoneToken, website } = request.body;

  return withWebOrderErrors(async () => {
    const store = await requireOrderingStore(db, request.parameters.slug);

    if (!store) {
      throw new HttpNotFoundError('Store not found');
    }

    // A bot filled the hidden field: it sees a success and nothing is stored.
    if (website?.trim()) {
      return { status: 201, body: { code: '0000', totalCents: 0 } };
    }

    if (!normalizePhone(phone)) {
      throw new WebOrderError(WebOrderErrorCode.Phone, 'Invalid phone');
    }

    if (!isPhoneVerified(phone, phoneToken)) {
      throw new WebOrderError(WebOrderErrorCode.PhoneUnverified, 'Confirm the phone with the WhatsApp code');
    }

    const placed = await placeWebOrder(
      db,
      store.id,
      { name: name.trim(), phone, items: toWebItems(items), delivery, payment },
      locateWithGoogle(process.env.GOOGLE_MAPS_API_KEY)
    );

    await linkVerificationToOrder(db, placed.phone, placed.orderId);

    await notifyPanel(panelEvents, store.id, [PanelTrigger.Orders, PanelTrigger.Conversations]);

    return { status: 201, body: { code: placed.code, totalCents: placed.totalCents } };
  });
}
