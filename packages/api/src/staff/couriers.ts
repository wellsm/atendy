import type { DbClient } from '../db';
import type { StaffSettings } from '../stores/types';

import { randomBytes, randomUUID } from 'node:crypto';

import { StaffRole } from './types';
import { phoneVariants } from '../storefront/web-order';
import { EvolutionRequestError } from '../whatsapp/evolution-client';
import { WhatsAppProviders } from '../whatsapp/providers';

const ECHO_WINDOW_MS = 10 * 60_000;

/**
 * What the courier earns for an order: the delivery fee the customer paid, or the store's fixed amount.
 */
export const courierFeeCents = (
  settings: Pick<StaffSettings, 'courierFeeMode' | 'courierFeeCents'>,
  order: { feeCents: number }
) => (settings.courierFeeMode === 'fixed' ? settings.courierFeeCents : order.feeCents);

export const courierMessageText = (input: { code: string; place: string; webBaseUrl: string; token: string }) =>
  `🛵 Nova entrega #${input.code}\n📍 ${input.place}\n\nSuas entregas: ${input.webBaseUrl.replace(/\/+$/, '')}/courier/${input.token}`;

/**
 * Sends the dispatch text from the store's own number. The row is written before the send so the `fromMe` echo is
 * recognized; best effort: a failure leaves the dispatch done and the row unconfirmed. Returns whether it was sent.
 */
export const sendCourierMessage = async (db: DbClient, input: { storeId: string; phone: string; text: string }) => {
  const store = await db.stores.findOne({
    select: {
      active: true,
      billing_blocked: true,
      whatsapp_provider: true,
      whatsapp_instance: true,
      whatsapp_instance_token: true
    },
    where: { id: input.storeId }
  });

  if (!store?.active || store.billing_blocked) {
    return false;
  }

  const id = randomUUID();

  try {
    const provider = WhatsAppProviders.forStore(store, process.env);

    await db.courier_messages.insertOne({
      data: {
        id,
        store_id: input.storeId,
        phone: input.phone,
        body: input.text,
        created_at: new Date().toISOString()
      }
    });

    const { providerMessageId } = await provider.sendText({ to: input.phone, text: input.text });

    await db.courier_messages.updateOne({ data: { provider_message_id: providerMessageId }, where: { id } });

    return true;
  } catch (error) {
    if (error instanceof EvolutionRequestError) {
      // Nothing was sent: the row would only hide a real message typed to that courier.
      await db.courier_messages.deleteOne({ where: { id } });
    }

    return false;
  }
};

/**
 * A `fromMe` event is the echo of a dispatch message when one with the same phone and body was written lately.
 */
export const isCourierEcho = async (db: DbClient, storeId: string, phone: string | undefined, body: string) => {
  if (!phone) {
    return false;
  }

  const { records } = await db.courier_messages.findMany({
    select: { phone: true, body: true },
    where: { store_id: storeId, created_at: { gte: new Date(Date.now() - ECHO_WINDOW_MS).toISOString() } }
  });

  return records.some((row) => row.body === body && phoneVariants(row.phone).includes(phone));
};

/**
 * The active courier (or delivering employee) of the store to dispatch to, with the link token the message carries.
 * A courier who never got a link gets one now (the owner can still generate another).
 */
export const findDispatchCourier = async (db: DbClient, storeId: string, courierId: string) => {
  const row = await db.staff.findOne({
    select: { store_id: true, active: true, role: true, delivers: true, phone: true, courier_token: true },
    where: { id: courierId }
  });

  if (
    !row ||
    row.store_id !== storeId ||
    !row.active ||
    !row.phone ||
    (row.role !== StaffRole.Courier && !row.delivers)
  ) {
    return undefined;
  }

  // Under the row lock, so two parallel dispatches share one new token.
  const token =
    row.courier_token ??
    (await db.transaction(async (tx) => {
      const locked = await tx.staff.findOne({ select: { courier_token: true }, where: { id: courierId }, lock: true });

      if (locked?.courier_token) {
        return locked.courier_token;
      }

      const fresh = randomBytes(32).toString('base64url');

      await tx.staff.updateOne({
        data: { courier_token: fresh, updated_at: new Date().toISOString() },
        where: { id: courierId }
      });

      return fresh;
    }));

  return { phone: row.phone, token };
};

export const messageCourier = (
  db: DbClient,
  storeId: string,
  courier: { phone: string; token: string },
  order: { code: string; address: string | null; neighborhood: string | null }
) =>
  sendCourierMessage(db, {
    storeId,
    phone: courier.phone,
    text: courierMessageText({
      code: order.code,
      place: order.neighborhood ?? order.address ?? '',
      webBaseUrl: process.env.WEB_BASE_URL ?? '',
      token: courier.token
    })
  });
