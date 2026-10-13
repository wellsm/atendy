import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelConversation, PanelIdentity } from '../types';

import { ConversationRepository } from '../../conversations/repository';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class ListConversationsRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class ListConversationsResponse implements Http.Response {
  status: 200;
  body: {
    conversations: PanelConversation[];
  };
}

export async function listConversationsHandler(
  request: Http.Incoming<ListConversationsRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ListConversationsResponse> {
  const store = await requireStore(db, request.identity);

  const conversations = await ConversationRepository.listForPanel(db, store.id);

  return { status: 200, body: { conversations: conversations.map(toPanelConversation) } };
}
