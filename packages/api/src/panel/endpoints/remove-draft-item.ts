import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { OrderRepository } from '../../orders/repository';
import { requireStaffDraft, withOrderErrors } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class RemoveDraftItemRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
    itemId: String.UUID;
  };
}

export declare class RemoveDraftItemResponse implements Http.Response {
  status: 200;
  body: {
    cart: PanelCart;
  };
}

export async function removeDraftItemHandler(
  request: Http.Incoming<RemoveDraftItemRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<RemoveDraftItemResponse> {
  const store = await requireStore(db, request.identity);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  const cart = await withOrderErrors(() => OrderRepository.removeItem(db, scope, request.parameters.itemId));

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
