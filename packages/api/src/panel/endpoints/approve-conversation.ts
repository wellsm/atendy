import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelConversationProvider } from '../provider';
import type { PanelConversation, PanelIdentity } from '../types';

import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class ApproveConversationRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
}

export declare class ApproveConversationResponse implements Http.Response {
  status: 200;
  body: {
    conversation: PanelConversation;
  };
}

/**
 * "Aprovar e continuar" / "Não é trote": the store allows what the bot asked, and the bot answers the messages that
 * waited (they stayed pending).
 */
export async function approveConversationHandler(
  request: Http.Incoming<ApproveConversationRequest>,
  { db, inboundQueue, panelEvents }: Service.Context<PanelConversationProvider>
): Promise<ApproveConversationResponse> {
  const store = await requireStore(db, request.identity);
  const { conversationId } = request.parameters;

  const conversation = await ConversationRepository.findForStore(db, store.id, conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  const reason = conversation.approval_reason;

  if (!reason) {
    throw new HttpConflictError('Nothing to approve');
  }

  await ConversationRepository.approve(db, { conversationId, reason });

  const messageId = await ConversationRepository.latestInboundMessageId(db, conversationId);

  if (messageId) {
    await inboundQueue.sendMessage({
      conversationId,
      eventId: `approval:${messageId}:${Date.now()}`,
      kind: InboundEventKind.Customer,
      messageId
    });
  }

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Conversations], conversationId);

  return { status: 200, body: { conversation: toPanelConversation({ ...conversation, approval_reason: null }) } };
}
