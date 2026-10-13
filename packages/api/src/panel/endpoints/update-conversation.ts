import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelConversation, PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../../conversations/repository';
import { ConversationMode } from '../../conversations/types';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class UpdateConversationRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
  body: {
    mode: ConversationMode;
  };
}

export declare class UpdateConversationResponse implements Http.Response {
  status: 200;
  body: {
    conversation: PanelConversation;
  };
}

/**
 * "Assumir" (human) or "Devolver ao bot" (bot). The bot answers only messages that arrive after it.
 */
export async function updateConversationHandler(
  request: Http.Incoming<UpdateConversationRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateConversationResponse> {
  const store = await requireStore(db, request.identity);
  const { conversationId } = request.parameters;
  const { mode } = request.body;

  const conversation = await ConversationRepository.findForStore(db, store.id, conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  await ConversationRepository.setMode(db, {
    conversationId,
    mode,
    reason: mode === ConversationMode.Human ? 'staff_took_over' : undefined
  });

  return {
    status: 200,
    body: {
      conversation: toPanelConversation({
        ...conversation,
        mode,
        handoff_reason: mode === ConversationMode.Human ? 'staff_took_over' : null
      })
    }
  };
}
