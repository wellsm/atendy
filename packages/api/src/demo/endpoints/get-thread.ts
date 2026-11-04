import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { MessageAuthor } from '../../conversations/types';
import type { PanelIdentity } from '../../panel/types';
import type { DemoProvider } from '../provider';

import { ConversationRepository } from '../../conversations/repository';
import { ConversationMode } from '../../conversations/types';
import { demoJid } from '../phone';
import { requireDemoStore } from '../store';

export declare class GetDemoThreadRequest implements Http.Request {
  identity: PanelIdentity;
  query: {
    slug: string;
    phone: string;
  };
}

export declare class GetDemoThreadResponse implements Http.Response {
  status: 200;
  body: {
    conversationId: string | null;
    mode: ConversationMode | null;
    /**
     * The bot is still answering the customer's latest messages.
     */
    typing: boolean;
    messages: { id: string; author: MessageAuthor; body: string; createdAt: string }[];
  };
}

/**
 * What the fake customer's phone shows: the conversation of that phone in that store (polled by the web).
 */
export async function getDemoThreadHandler(
  request: Http.Incoming<GetDemoThreadRequest>,
  { db }: Service.Context<DemoProvider>
): Promise<GetDemoThreadResponse> {
  const { slug, phone } = request.query;
  const store = await requireDemoStore(db, request.identity, slug, phone);

  const conversationId = await ConversationRepository.findConversation(db, {
    storeId: store.id,
    phone,
    jid: demoJid(phone)
  });

  if (!conversationId) {
    return { status: 200, body: { conversationId: null, mode: null, typing: false, messages: [] } };
  }

  const [conversation, messages, pending] = await Promise.all([
    db.conversations.findOne({ select: { mode: true, approval_reason: true }, where: { id: conversationId } }),
    ConversationRepository.messagesForPanel(db, conversationId),
    ConversationRepository.pendingInbound(db, conversationId)
  ]);

  const mode = conversation?.mode ?? ConversationMode.Bot;

  return {
    status: 200,
    body: {
      conversationId,
      mode,
      // A batch waiting for the store's approval is pending too, but nobody is typing.
      typing: mode === ConversationMode.Bot && !conversation?.approval_reason && pending.length > 0,
      messages: messages.map(({ id, author, body, created_at }) => ({ id, author, body, createdAt: created_at }))
    }
  };
}
