import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelDraftProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { OrderRepository } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStaffDraft, withOrderErrors } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class AddDraftItemRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    conversationId: String.UUID;
  };
  body: {
    productId: String.UUID;
    qty: Integer.Range<1, 999>;
    selections: { groupId: String.UUID; optionIds: String.UUID[] }[];
    notes?: String.Size<0, 200> | null;
  };
}

export declare class AddDraftItemResponse implements Http.Response {
  status: 200;
  body: {
    cart: PanelCart;
  };
}

/**
 * The attendant adds an item: priced from the menu like the bot's, without the store's own limits.
 */
export async function addDraftItemHandler(
  request: Http.Incoming<AddDraftItemRequest>,
  { db, panelEvents }: Service.Context<PanelDraftProvider>
): Promise<AddDraftItemResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Conversations);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);
  const { productId, qty, selections, notes } = request.body;

  const product = (await MenuRepository.load(db, store.id)).find(({ id }) => id === productId);

  if (!product) {
    throw new HttpBadRequestError('Product not found or paused', { field: 'unknown_product' });
  }

  const cart = await withOrderErrors(() =>
    OrderRepository.addItem(db, scope, {
      product,
      qty,
      selections: selections.map(({ groupId, optionIds }) => ({ group_id: groupId, option_ids: optionIds })),
      notes: notes?.trim() || null,
      skipLimits: true,
      byStaff: true
    })
  );

  await notifyPanel(
    panelEvents,
    store.id,
    [PanelTrigger.Orders, PanelTrigger.Conversations],
    request.parameters.conversationId
  );

  return { status: 200, body: { cart: toPanelCart(cart) } };
}
