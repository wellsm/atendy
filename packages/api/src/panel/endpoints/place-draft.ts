import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelDraftProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { OrderRepository } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStaffDraft, withOrderErrors } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class PlaceDraftRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db, panelEvents }: Service.Context<PanelDraftProvider>
): Promise<PlaceDraftResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Conversations);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  const cart = await withOrderErrors(() => OrderRepository.place(db, scope, { byStaff: true }));

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    request.parameters.conversationId
  );

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
