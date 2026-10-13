import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelConversation, PanelIdentity, PanelMessage } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../../conversations/repository';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class GetConversationRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class GetConversationResponse implements Http.Response {
  status: 200;
  body: {
    conversation: PanelConversation;
    messages: PanelMessage[];
  };
}

export async function getConversationHandler(
  request: Http.Incoming<GetConversationRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<GetConversationResponse> {
  const store = await requireStore(db, request.identity);

  const conversation = await ConversationRepository.findForStore(db, store.id, request.parameters.conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  const messages = await ConversationRepository.messagesForPanel(db, conversation.id);

  return {
    status: 200,
    body: {
      conversation: toPanelConversation(conversation),
      messages: messages.map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.created_at
      }))
    }
  };
}
