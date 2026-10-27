import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { OrderRepository } from '../../orders/repository';
import { requireStaffDraft, withOrderErrors } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class PlaceDraftRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class PlaceDraftResponse implements Http.Response {
  status: 200;
  body: {
    cart: PanelCart;
  };
}

/**
 * "Fechar pedido": the attendant places the draft. No closing cutoff or new-customer review (the store decides) and
 * no billing: what the bot did was billed at the handoff.
 */
export async function placeDraftHandler(
  request: Http.Incoming<PlaceDraftRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<PlaceDraftResponse> {
  const store = await requireStore(db, request.identity);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  const cart = await withOrderErrors(() => OrderRepository.place(db, scope, { byStaff: true }));

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
