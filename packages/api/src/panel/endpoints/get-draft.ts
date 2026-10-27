import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelCart, PanelIdentity } from '../types';

import { OrderRepository } from '../../orders/repository';
import { requireStaffDraft } from '../draft';
import { requireStore } from '../store';
import { toPanelCart } from '../types';

export declare class GetDraftRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class GetDraftResponse implements Http.Response {
  status: 200;
  body: {
    cart: PanelCart | null;
    /**
     * The customer's last delivery address, offered as "Usar endereço anterior".
     */
    savedAddress: { address: string; neighborhood: string | null } | null;
  };
}

/**
 * The draft a person builds in a conversation they handle (the bot's half-built one included).
 */
export async function getDraftHandler(
  request: Http.Incoming<GetDraftRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetDraftResponse> {
  const store = await requireStore(db, request.identity);
  const scope = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  const [draftId, saved] = await Promise.all([
    OrderRepository.findDraftId(db, scope.conversationId),
    OrderRepository.findSavedAddress(db, scope)
  ]);

  return {
    status: 200,
    body: {
      cart: draftId ? toPanelCart(await OrderRepository.getCart(db, draftId)) : null,
      savedAddress: saved ? { address: saved.address, neighborhood: saved.neighborhood } : null
    }
  };
}
