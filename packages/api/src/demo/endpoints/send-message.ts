import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelIdentity } from '../../panel/types';
import type { DemoProvider } from '../provider';

import { HttpBadRequestError } from '@ez4/gateway';

import { InboundEventKind } from '../../conversations/queues/inbound';
import { ConversationRepository } from '../../conversations/repository';
import { notifyPanel } from '../../realtime/notify';
import { PanelTrigger } from '../../realtime/types';
import { ParsedEventKind } from '../../whatsapp/types';
import { demoJid } from '../phone';
import { requireDemoStore } from '../store';

export declare class SendDemoMessageRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    slug: String.Size<1, 80>;
    /**
     * Fake phone (`5500` + 9 digits) the browser generated for this slot.
     */
    phone: String.Size<13, 13>;
    name: String.Size<1, 60>;
    text: String.Size<1, 4000>;
    /**
     * Same id on a retried send, so the message is stored and answered once.
     */
    clientMessageId: String.UUID;
  };
}

export declare class SendDemoMessageResponse implements Http.Response {
  status: 202;
  body: {
    conversationId: string;
  };
}

/**
 * A fake customer writes to the store: ingested like the webhook (`@sim` JID, so replies never reach WhatsApp).
 * No staff `authorize`: the customer is talking, not the staff.
 */
export async function sendDemoMessageHandler(
  request: Http.Incoming<SendDemoMessageRequest>,
  { db, inboundQueue, panelEvents }: Service.Context<DemoProvider>
): Promise<SendDemoMessageResponse> {
  const { slug, phone, clientMessageId } = request.body;
  const name = request.body.name.trim();
  const text = request.body.text.trim();

  if (!name) {
    throw new HttpBadRequestError('Name is required.', { field: 'name' });
  }

  if (!text) {
    throw new HttpBadRequestError('Text is required.', { field: 'text' });
  }

  const store = await requireDemoStore(db, request.identity, slug, phone);
  const providerMessageId = `demo:${clientMessageId}`;

  const ingested = await ConversationRepository.ingestCustomerMessage(db, {
    storeId: store.id,
    message: {
      kind: ParsedEventKind.Message,
      instance: 'demo',
      providerMessageId,
      fromMe: false,
      jid: demoJid(phone),
      phone,
      pushName: name,
      text,
      sentAt: new Date().toISOString()
    }
  });

  if (!ingested.processed) {
    await inboundQueue.sendMessage({
      conversationId: ingested.conversationId,
      eventId: providerMessageId,
      kind: InboundEventKind.Customer,
      messageId: ingested.messageId
    });
  }

  await notifyPanel(panelEvents, store.id, [PanelTrigger.Conversations], ingested.conversationId);

  return { status: 202, body: { conversationId: ingested.conversationId } };
}
