import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelDraftProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { OrderRepository } from '../../orders/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStaffDraft } from '../draft';
import { requireStore } from '../store';

export declare class DiscardDraftRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class DiscardDraftResponse implements Http.Response {
  status: 200;
  body: {
    discarded: true;
  };
}

/**
 * "Descartar pedido": the attendant drops the order still being built; the customer gets no message.
 */
export async function discardDraftHandler(
  request: Http.Incoming<DiscardDraftRequest>,
  { db, panelEvents }: Service.Context<PanelDraftProvider>
): Promise<DiscardDraftResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Conversations);
  const { conversationId } = await requireStaffDraft(db, store.id, request.parameters.conversationId);

  if (!(await OrderRepository.discardStaffDraft(db, conversationId))) {
    throw new HttpNotFoundError('No order in progress');
  }

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Orders, PanelTrigger.Conversations], conversationId);

  return { status: 200, body: { discarded: true } };
}
