import type { Db } from '../../src/db';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { ConversationRepository } from '../../src/conversations/repository';
import { ConversationMode, MessageAuthor } from '../../src/conversations/types';
import { minutesAgo, seedConversation, seedMessage, seedStore } from '../support/fixtures';

describe('ConversationRepository (panel)', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  it('lists conversations with a person in charge first, then newest', async () => {
    const { storeId } = await seedStore(db);

    const older = await seedConversation(db, storeId);
    const newer = await seedConversation(db, storeId);
    const human = await seedConversation(db, storeId);

    await db.conversations.updateOne({
      data: { last_message_at: minutesAgo(30) },
      where: { id: older.conversationId }
    });
    await db.conversations.updateOne({ data: { last_message_at: minutesAgo(5) }, where: { id: newer.conversationId } });
    await db.conversations.updateOne({
      data: { last_message_at: minutesAgo(60) },
      where: { id: human.conversationId }
    });

    await ConversationRepository.handOffToHuman(db, { conversationId: human.conversationId, reason: 'needs_human' });

    const list = await ConversationRepository.listForPanel(db, storeId);

    deepEqual(
      list.map(({ id }) => id),
      [human.conversationId, newer.conversationId, older.conversationId]
    );

    equal(list[0]!.handoff_reason, 'needs_human');
    ok(list[0]!.customer.phone);

    const otherStore = await seedStore(db);

    deepEqual(await ConversationRepository.listForPanel(db, otherStore.storeId), []);
  });

  it('keeps a conversation that needs a person even when it is older than the newest page', async () => {
    const { storeId } = await seedStore(db);
    const human = await seedConversation(db, storeId);

    await db.conversations.updateOne({
      data: { last_message_at: minutesAgo(600) },
      where: { id: human.conversationId }
    });
    await ConversationRepository.handOffToHuman(db, { conversationId: human.conversationId, reason: 'customer_asked' });

    for (let index = 0; index < 50; index++) {
      await seedConversation(db, storeId);
    }

    const list = await ConversationRepository.listForPanel(db, storeId);

    equal(list[0]!.id, human.conversationId);
  });

  it('finds a conversation only inside its store and returns its messages oldest first', async () => {
    const { storeId } = await seedStore(db);
    const otherStore = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    await seedMessage(db, {
      storeId,
      conversationId,
      author: MessageAuthor.Bot,
      body: 'Olá!',
      createdAt: minutesAgo(-1)
    });

    equal((await ConversationRepository.findForStore(db, storeId, conversationId))?.id, conversationId);
    equal(await ConversationRepository.findForStore(db, otherStore.storeId, conversationId), undefined);
    equal(await ConversationRepository.findForStore(db, storeId, randomUUID()), undefined);

    const messages = await ConversationRepository.messagesForPanel(db, conversationId);

    deepEqual(
      messages.map(({ body }) => body),
      ['oi', 'Olá!']
    );
  });

  it('switches mode, clearing the reason when the bot takes back', async () => {
    const { storeId } = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    await ConversationRepository.setMode(db, {
      conversationId,
      mode: ConversationMode.Human,
      reason: 'staff_took_over'
    });

    let conversation = await ConversationRepository.findForStore(db, storeId, conversationId);

    equal(conversation?.mode, ConversationMode.Human);
    equal(conversation?.handoff_reason, 'staff_took_over');

    await ConversationRepository.setMode(db, { conversationId, mode: ConversationMode.Bot });

    conversation = await ConversationRepository.findForStore(db, storeId, conversationId);

    equal(conversation?.mode, ConversationMode.Bot);
    equal(conversation?.handoff_reason, null);
  });

  it('claims the echo of a pending staff send', async () => {
    const { storeId } = await seedStore(db);
    const { conversationId } = await seedConversation(db, storeId);

    await ConversationRepository.createPendingOutbound(db, {
      storeId,
      conversationId,
      body: 'Seu pedido saiu para entrega!',
      author: MessageAuthor.Staff
    });

    const claimed = await ConversationRepository.claimPendingEcho(db, {
      storeId,
      conversationId,
      body: 'Seu pedido saiu para entrega!',
      providerMessageId: 'EVO-1'
    });

    equal(claimed, true);

    const rows = await db.messages.findMany({
      select: { author: true, provider_message_id: true },
      where: { conversation_id: conversationId, author: MessageAuthor.Staff }
    });

    deepEqual(rows.records, [{ author: MessageAuthor.Staff, provider_message_id: 'EVO-1' }]);
  });
});
