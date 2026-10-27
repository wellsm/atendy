import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { StorefrontOrderProvider } from '../provider';
import type { WebOrderDeliveryInput, WebOrderItemInput } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { locateWithGoogle } from '../../stores/geocoding';
import { toWebItems } from '../types';
import { withWebOrderErrors } from '../web-errors';
import { quoteWebOrder, requireOrderingStore } from '../web-order';

export declare class QuoteWebOrderRequest implements Http.Request {
  parameters: {
    slug: string;
  };
  body: {
    items: WebOrderItemInput[];
    delivery: WebOrderDeliveryInput;
  };
}

export declare class QuoteWebOrderResponse implements Http.Response {
  status: 200;
  body: {
    subtotalCents: number;
    /**
     * Null until the delivery can be priced (`deliveryError`).
     */
    feeCents: number | null;
    totalCents: number | null;
    distanceKm: number | null;
    deliveryError: 'location_needed' | 'out_of_area' | null;
    minOrderCents: number | null;
    belowMinimum: boolean;
  };
}

/**
 * Checkout prices: subtotal from the menu and the delivery fee, nothing written.
 */
export async function quoteWebOrderHandler(
  request: Http.Incoming<QuoteWebOrderRequest>,
  { db }: Service.Context<StorefrontOrderProvider>
): Promise<QuoteWebOrderResponse> {
  return withWebOrderErrors(async () => {
    const store = await requireOrderingStore(db, request.parameters.slug);

    if (!store) {
      throw new HttpNotFoundError('Store not found');
    }

    const quote = await quoteWebOrder(
      db,
      store.id,
      { items: toWebItems(request.body.items), delivery: request.body.delivery },
      locateWithGoogle(process.env.GOOGLE_MAPS_API_KEY)
    );

    return { status: 200, body: quote };
  });
}
