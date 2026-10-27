import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelDraftProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { OrderRepository } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
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
  { db, panelEvents }: Service.Context<PanelDraftProvider>
): Promise<RemoveDraftItemResponse> {
  const store = await requireStore(db, request.identity);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  const cart = await withOrderErrors(() => OrderRepository.removeItem(db, scope, request.parameters.itemId));

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    request.parameters.conversationId
  );

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
