import type { Db } from '../src/db';

import { equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { ConversationMode, MessageAuthor, MessageDirection } from '../src/conversations/types';
import { DeliveryMode, PaymentMethod, RouterType, WhatsAppProviderType } from '../src/stores/types';

describe('Db schema', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  const now = new Date().toISOString();

  const createStore = async () => {
    const id = randomUUID();

    await db.stores.insertOne({
      data: {
        id,
        name: 'Test Pizza',
        slug: `test-${id}`,
        timezone: 'America/Sao_Paulo',
        accepting_orders: true,
        active: true,
        router: RouterType.Llm,
        llm_model: 'test/model',
        whatsapp_provider: WhatsAppProviderType.Evolution,
        whatsapp_webhook_secret: randomUUID(),
        delivery_mode: DeliveryMode.Flat,
        flat_fee_cents: 500,
        payment_methods: [PaymentMethod.Pix, PaymentMethod.Cash],
        created_at: now,
        updated_at: now
      }
    });

    return id;
  };

  it('stores and reads back a store with its payment methods', async () => {
    const storeId = await createStore();

    const store = await db.stores.findOne({
      select: { flat_fee_cents: true, payment_methods: true },
      where: { id: storeId }
    });

    equal(store?.flat_fee_cents, 500);
    equal(store?.payment_methods.length, 2);
  });

  it('rejects a second message with the same provider_message_id in the same store', async () => {
    const storeId = await createStore();
    const customerId = randomUUID();
    const conversationId = randomUUID();

    await db.customers.insertOne({
      data: {
        id: customerId,
        store_id: storeId,
        phone: '5511999998888',
        whatsapp_jid: '5511999998888@s.whatsapp.net',
        created_at: now,
        updated_at: now
      }
    });

    await db.conversations.insertOne({
      data: {
        id: conversationId,
        store_id: storeId,
        customer_id: customerId,
        mode: ConversationMode.Bot,
        last_message_at: now,
        created_at: now
      }
    });

    const message = {
      store_id: storeId,
      conversation_id: conversationId,
      direction: MessageDirection.In,
      author: MessageAuthor.Customer,
      body: 'oi',
      provider_message_id: 'WAMID-1',
      created_at: now
    };

    await db.messages.insertOne({ data: { id: randomUUID(), ...message } });

    await rejects(db.messages.insertOne({ data: { id: randomUUID(), ...message } }));
  });

  it('stores the WhatsApp instance token and the customer reply JID', async () => {
    const storeId = await createStore();

    await db.stores.updateOne({ data: { whatsapp_instance_token: 'tok' }, where: { id: storeId } });

    await db.customers.insertOne({
      data: {
        id: randomUUID(),
        store_id: storeId,
        phone: '5511988887777',
        whatsapp_jid: '5511988887777@s.whatsapp.net',
        created_at: now,
        updated_at: now
      }
    });

    const store = await db.stores.findOne({ select: { whatsapp_instance_token: true }, where: { id: storeId } });
    const customer = await db.customers.findOne({
      select: { whatsapp_jid: true },
      where: { store_id: storeId, phone: '5511988887777' }
    });

    equal(store?.whatsapp_instance_token, 'tok');
    equal(customer?.whatsapp_jid, '5511988887777@s.whatsapp.net');
  });
});
