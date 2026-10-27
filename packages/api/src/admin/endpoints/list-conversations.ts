import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ConversationFilter } from '../conversations/repository';
import type { AdminProvider } from '../provider';
import type { AdminConversationRow, AdminIdentity } from '../types';

import { InspectorRepository } from '../conversations/repository';

export declare class ListConversationsRequest implements Http.Request {
  identity: AdminIdentity;
  query: {
    /**
     * Absent = every store.
     */
    storeId?: String.UUID;
    filter: ConversationFilter;
    /**
     * `lastMessageAt` of the last row already shown (next page).
     */
    before?: String.DateTime;
  };
}

export declare class ListConversationsResponse implements Http.Response {
  status: 200;
  body: {
    conversations: AdminConversationRow[];
  };
}

/**
 * Conversations of any store for the admin inspector, newest first, 50 per page.
 */
export async function listAdminConversationsHandler(
  request: Http.Incoming<ListConversationsRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<ListConversationsResponse> {
  const { storeId, filter, before } = request.query;

  return { status: 200, body: { conversations: await InspectorRepository.list(db, { storeId, filter, before }) } };
}
