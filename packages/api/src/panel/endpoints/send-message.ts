import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelSendProvider } from '../provider';
import type { PanelConversation, PanelIdentity } from '../types';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { ConversationRepository } from '../../conversations/repository';
import { ConversationMode } from '../../conversations/types';
import { sendStaffMessage, StaffSendError } from '../send';
import { requireStore } from '../store';
import { toPanelConversation } from '../types';

export declare class SendMessageRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    conversationId: String.UUID;
  };
  body: {
    text: String.Size<1, 4000>;
  };
}

export declare class SendMessageResponse implements Http.Response {
  status: 201;
  body: {
    conversation: PanelConversation;
  };
}

const PANEL_REPLY_REASON = 'staff_replied_from_panel';

/**
 * Staff reply from the panel. Takes the conversation over first (like a reply typed on the phone), so the bot
 * stops even if the send fails.
 */
export async function sendMessageHandler(
  request: Http.Incoming<SendMessageRequest>,
  { db }: Service.Context<PanelSendProvider>
): Promise<SendMessageResponse> {
  const store = await requireStore(db, request.identity);
  const text = request.body.text.trim();

  if (!text) {
    throw new HttpBadRequestError('Message is empty');
  }

  const conversation = await ConversationRepository.findForStore(db, store.id, request.parameters.conversationId);

  if (!conversation) {
    throw new HttpNotFoundError('Conversation not found');
  }

  const takeOver = conversation.mode !== ConversationMode.Human;

  if (takeOver) {
    await ConversationRepository.setMode(db, {
      conversationId: conversation.id,
      mode: ConversationMode.Human,
      reason: PANEL_REPLY_REASON
    });
  }

  try {
    await sendStaffMessage(db, {
      storeId: store.id,
      conversationId: conversation.id,
      to: conversation.customer.jid,
      text
    });
  } catch (error) {
    if (error instanceof StaffSendError) {
      throw new HttpConflictError(error.message);
    }

    throw error;
  }

  return {
    status: 201,
    body: {
      conversation: toPanelConversation({
        ...conversation,
        mode: ConversationMode.Human,
        handoff_reason: takeOver ? PANEL_REPLY_REASON : conversation.handoff_reason,
        approval_reason: null
      })
    }
  };
}
