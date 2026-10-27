import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingStep } from '../../billing/progress';
import type { OrderStatus } from '../../orders/types';
import type { PanelThreadProvider } from '../provider';
import type { PanelConversation, PanelIdentity, PanelMessage } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { stepsFromOrder } from '../../billing/progress';
import { ConversationRepository } from '../../conversations/repository';
import { OrderRepository } from '../../orders/repository';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

const AUDIO_READ_SECONDS = 3600;

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
    /**
     * Placed and abandoned orders of the conversation, shown as marks between its messages.
     */
    orders: { id: string; code: string | null; status: OrderStatus; at: string; totalCents: number }[];
    /**
     * Steps the current draft reached; null without a draft.
     */
    progress: BillingStep[] | null;
  };
}

export async function getConversationHandler(
  request: Http.Incoming<GetConversationRequest>,
  { db, voiceNotes }: Service.Context<PanelThreadProvider>
): Promise<GetConversationResponse> {
  const store = await requireStore(db, request.identity);

  const conversation = await ConversationRepository.findForStore(db, store.id, request.parameters.conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  const [messages, orders, draft] = await Promise.all([
    ConversationRepository.messagesForPanel(db, conversation.id),
    OrderRepository.marksForConversation(db, conversation.id),
    OrderRepository.findDraftRow(db, conversation.id)
  ]);

  return {
    status: 200,
    body: {
      conversation: toPanelConversation(conversation),
      messages: await Promise.all(
        messages.map(async (message) => ({
          id: message.id,
          author: message.author,
          body: message.body,
          createdAt: message.created_at,
          reaction: message.reaction ?? null,
          audioUrl: message.audio_key
            ? await voiceNotes.getReadUrl(message.audio_key, { expiresIn: AUDIO_READ_SECONDS })
            : null
        }))
      ),
      orders,
      progress: draft ? stepsFromOrder(draft) : null
    }
  };
}
