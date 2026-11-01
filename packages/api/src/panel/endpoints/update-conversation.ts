import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelConversationProvider } from '../provider';
import type { PanelConversation, PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { ConversationMode } from '../../conversations/types';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class UpdateConversationRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
 * "Assumir" (human) or "Devolver ao bot" (bot). Taking over a conversation waiting for approval keeps the approval
 * reason as the handoff reason. Back to the bot, it answers the customer messages nobody answered.
 */
export async function updateConversationHandler(
  request: Http.Incoming<UpdateConversationRequest>,
  { db, inboundQueue, panelEvents }: Service.Context<PanelConversationProvider>
): Promise<UpdateConversationResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Conversations);
  const { conversationId } = request.parameters;
  const { mode } = request.body;

  const conversation = await ConversationRepository.findForStore(db, store.id, conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  const reason = mode === ConversationMode.Human ? (conversation.approval_reason ?? 'staff_took_over') : undefined;

  await ConversationRepository.setMode(db, { conversationId, mode, reason });

  if (mode === ConversationMode.Bot) {
    const messageId = await ConversationRepository.reopenUnanswered(db, conversationId);

    if (messageId) {
      await inboundQueue.sendMessage({
        conversationId,
        eventId: `resume:${messageId}:${Date.now()}`,
        kind: InboundEventKind.Customer,
        messageId
      });
    }
  }

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Conversations], conversationId);

  return {
    status: 200,
    body: {
      conversation: toPanelConversation({
        ...conversation,
        mode,
        handoff_reason: reason ?? null,
        approval_reason: null
      })
    }
  };
}
