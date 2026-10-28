import type { DbClient } from '../../src/db';
import type { MenuProduct } from '../../src/menu/repository';
import type { DraftScope } from '../../src/orders/repository';
import type { StorePolicy } from '../../src/stores/types';

import { randomBytes, randomUUID } from 'node:crypto';

import { ConversationRepository } from '../../src/conversations/repository';
import { MessageAuthor, MessageDirection } from '../../src/conversations/types';
import { DEMO_MENU } from '../../src/menu/demo-menu';
import { MenuRepository } from '../../src/menu/repository';
import { OrderRepository } from '../../src/orders/repository';
import { Fulfillment } from '../../src/orders/types';
import { DeliveryMode, PaymentMethod, RouterType, WhatsAppProviderType } from '../../src/stores/types';
import { ParsedEventKind } from '../../src/whatsapp/types';

/**
 * Store open every day 00:00–00:00 (24h) unless `hours` is given, accepting orders.
 */
export const seedStore = async (
  db: DbClient,
  overrides: {
    accepting_orders?: boolean;
    active?: boolean;
    hours?: { weekday: number; opens_at: string; closes_at: string }[];
    router?: RouterType;
    delivery_mode?: DeliveryMode;
    flat_fee_cents?: number;
    payment_methods?: PaymentMethod[];
    timezone?: string;
    policy?: StorePolicy;
  } = {}
) => {
  const storeId = randomUUID();
  const secret = randomBytes(24).toString('hex');
  const instance = `atd_${storeId}`;
  const now = new Date().toISOString();

  await db.stores.insertOne({
    data: {
      id: storeId,
      name: 'Pizzaria Teste',
      slug: `t-${storeId}`,
      timezone: overrides.timezone ?? 'America/Sao_Paulo',
      accepting_orders: overrides.accepting_orders ?? true,
      active: overrides.active ?? true,
      router: overrides.router ?? RouterType.Llm,
      llm_model: 'test/model',
      whatsapp_provider: WhatsAppProviderType.Evolution,
      whatsapp_instance: instance,
      whatsapp_instance_token: 'instance-token',
      whatsapp_webhook_secret: secret,
      delivery_mode: overrides.delivery_mode ?? DeliveryMode.Flat,
      flat_fee_cents: overrides.flat_fee_cents ?? 0,
      payment_methods: overrides.payment_methods ?? [PaymentMethod.Pix],
      policy: overrides.policy ?? null,
      created_at: now,
      updated_at: now
    }
  });

  const hours =
    overrides.hours ?? [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' }));

  for (const hour of hours) {
    await db.store_hours.insertOne({ data: { id: randomUUID(), store_id: storeId, ...hour } });
  }

  return { storeId, secret, instance };
};

/**
 * Evolution v2 `messages.upsert` webhook body (Baileys). Shape per Evolution API v2.3 docs;
 * replace with a captured real payload during the manual smoke test if it differs.
 */
export const evolutionTextEvent = (
  overrides: {
    id?: string;
    fromMe?: boolean;
    remoteJid?: string;
    remoteJidAlt?: string;
    text?: string;
    instance?: string;
    message?: Record<string, unknown>;
  } = {}
) => ({
  event: 'messages.upsert',
  instance: overrides.instance ?? 'atd_store',
  data: {
    key: {
      remoteJid: overrides.remoteJid ?? '5511999998888@s.whatsapp.net',
      ...(overrides.remoteJidAlt ? { remoteJidAlt: overrides.remoteJidAlt } : {}),
      fromMe: overrides.fromMe ?? false,
      id: overrides.id ?? '3EB0A1B2C3D4E5F6'
    },
    pushName: 'Maria',
    message: overrides.message ?? { conversation: overrides.text ?? 'oi' },
    messageType: 'conversation',
    messageTimestamp: 1791580800
  },
  date_time: '2026-10-09T21:20:00.000Z',
  sender: '5511900000000@s.whatsapp.net'
});

/**
 * Imports `DEMO_MENU` for the store and returns it as the agent sees it.
 */
export const seedMenu = async (db: DbClient, storeId: string) => {
  await MenuRepository.importMenu(db, storeId, DEMO_MENU);

  return MenuRepository.load(db, storeId);
};

/**
 * A customer with one processed-later inbound message, so the conversation and customer exist.
 */
export const seedConversation = async (db: DbClient, storeId: string) => {
  const phone = `55119${randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-8)}`;

  const ingested = await ConversationRepository.ingestCustomerMessage(db, {
    storeId,
    message: {
      kind: ParsedEventKind.Message,
      instance: 'i',
      providerMessageId: randomUUID(),
      fromMe: false,
      jid: `${phone}@s.whatsapp.net`,
      phone,
      text: 'oi',
      sentAt: new Date().toISOString()
    }
  });

  const conversation = await db.conversations.findOne({
    select: { customer_id: true },
    where: { id: ingested.conversationId }
  });

  return {
    conversationId: ingested.conversationId,
    customerId: conversation!.customer_id,
    messageId: ingested.messageId
  };
};

export const productByName = (menu: MenuProduct[], name: string) => {
  const product = menu.find((item) => item.name === name);

  if (!product) {
    throw new Error(`Product ${name} not in menu`);
  }

  return product;
};

export const groupIdOf = (product: MenuProduct, groupName: string) => {
  const group = product.groups.find(({ name }) => name === groupName);

  if (!group) {
    throw new Error(`Group ${groupName} not in ${product.name}`);
  }

  return group.id;
};

export const optionIdOf = (product: MenuProduct, groupName: string, optionName: string) => {
  const option = product.groups.find(({ name }) => name === groupName)?.options.find(({ name }) => name === optionName);

  if (!option) {
    throw new Error(`Option ${optionName} not in ${product.name} / ${groupName}`);
  }

  return option.id;
};

export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * Places a pickup order with one Coca-Cola 2L paid by Pix, or `method` (the store must accept it). Returns the order
 * id. Call once per conversation: while that order is `placed`, later items go into it.
 */
export const placeOrder = async (
  db: DbClient,
  scope: DraftScope,
  menu: MenuProduct[],
  method: PaymentMethod = PaymentMethod.Pix
) => {
  await OrderRepository.addItem(db, scope, { product: productByName(menu, 'Coca-Cola 2L'), qty: 1, selections: [] });
  await OrderRepository.setFulfillment(db, scope, Fulfillment.Pickup);
  await OrderRepository.setPayment(db, scope, { method });

  return (await OrderRepository.place(db, scope)).order_id;
};

const hhmm = (date: Date) => date.toISOString().slice(11, 16);

/**
 * One opening range (UTC) that started an hour ago and closes `minutes` from now. Use with `timezone: 'UTC'`.
 */
export const hoursClosingIn = (minutes: number) => {
  const opens = new Date(Date.now() - 60 * 60_000);

  return [
    { weekday: opens.getUTCDay(), opens_at: hhmm(opens), closes_at: hhmm(new Date(Date.now() + minutes * 60_000)) }
  ];
};

/**
 * A processed message with a fixed time (history tests).
 */
export const seedMessage = async (
  db: DbClient,
  input: { storeId: string; conversationId: string; author: MessageAuthor; body: string; createdAt: string }
) => {
  await db.messages.insertOne({
    data: {
      id: randomUUID(),
      store_id: input.storeId,
      conversation_id: input.conversationId,
      direction: input.author === MessageAuthor.Customer ? MessageDirection.In : MessageDirection.Out,
      author: input.author,
      body: input.body,
      provider_message_id: randomUUID(),
      processed_at: input.createdAt,
      created_at: input.createdAt
    }
  });
};
