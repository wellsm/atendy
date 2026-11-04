import type { Db } from '../../src/db';

import { equal, ok } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { ConversationRepository } from '../../src/conversations/repository';
import { MessageAuthor, MessageDirection } from '../../src/conversations/types';
import { sendStaffMessage } from '../../src/panel/send';
import { WhatsAppProviders } from '../../src/whatsapp/providers';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { seedStore } from '../support/fixtures';

describe('sendStaffMessage', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  afterEach(() => mock.restoreAll());

  it('confirms a staff message to a fake demo customer (@sim) without WhatsApp', async () => {
    const { storeId } = await seedStore(db);
    const forStore = mock.method(WhatsAppProviders, 'forStore', () => {
      throw new Error('WhatsApp is not connected');
    });

    const { conversationId } = await ConversationRepository.ingestCustomerMessage(db, {
      storeId,
      message: {
        kind: ParsedEventKind.Message,
        instance: 'demo',
        providerMessageId: 'demo:staff-1',
        fromMe: false,
        jid: '5500987654321@sim',
        phone: '5500987654321',
        text: 'oi',
        sentAt: new Date().toISOString()
      }
    });

    await sendStaffMessage(db, { storeId, conversationId, to: '5500987654321@sim', text: 'Pedido aceito!' });

    equal(forStore.mock.callCount(), 0);

    const {
      records: [row]
    } = await db.messages.findMany({
      select: { author: true, provider_message_id: true },
      where: { conversation_id: conversationId, direction: MessageDirection.Out }
    });

    equal(row?.author, MessageAuthor.Staff);
    ok(row?.provider_message_id.startsWith('sim:'));
  });
});
