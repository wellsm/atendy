import type { DbClient } from '../db';

import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { normalizePhone, WebOrderError, WebOrderErrorCode } from './web-order';
import { OtpSendError } from './whatsapp-otp';
import { isValidSecret } from '../whatsapp/secret';

export const CODE_TTL_SECONDS = 10 * 60;

/**
 * Countdown before the checkout offers "resend".
 */
export const RESEND_WAIT_SECONDS = 59;

/**
 * Codes per phone per hour, across stores: protects whoever owns the number from a flood of messages.
 */
const MAX_CODES_PER_PHONE = 3;

/**
 * Codes per caller IP per hour: one person cannot pay for codes to many numbers.
 */
const MAX_CODES_PER_IP = 10;

/**
 * Tries per code; the next one needs a new code.
 */
const MAX_ATTEMPTS = 5;

/**
 * A verified phone skips the code in this browser for this long, in every store.
 */
export const PHONE_TOKEN_DAYS = 30;

const HOUR_MS = 60 * 60_000;

const sign = (value: string) => {
  const secret = process.env.WEB_PHONE_TOKEN_SECRET;

  if (!secret) {
    throw new Error('WEB_PHONE_TOKEN_SECRET is not set');
  }

  return createHmac('sha256', secret).update(value).digest('base64url');
};

/**
 * The caller IP from API Gateway's `x-forwarded-for` (the gateway appends the real one last, so a forged header only
 * adds entries before it); undefined when there is none (local serve).
 */
export const callerIp = (forwardedFor: string | undefined) => forwardedFor?.split(',').at(-1)?.trim() || undefined;

const validPhone = (typed: string) => {
  const phone = normalizePhone(typed);

  if (!phone) {
    throw new WebOrderError(WebOrderErrorCode.Phone, 'Invalid phone');
  }

  return phone;
};

/**
 * Creates and sends a 6-digit code (valid `CODE_TTL_SECONDS`) unless the phone waits the resend countdown or the phone
 * or IP used up the hour. Returns the code only so local dev can show it; callers never echo it otherwise.
 */
export const sendPhoneCode = async (
  db: DbClient,
  storeId: string,
  input: { phone: string; ip: string | undefined },
  send: (phone: string, code: string) => Promise<string | undefined>
) => {
  const phone = validPhone(input.phone);
  const now = Date.now();
  const hourAgo = new Date(now - HOUR_MS).toISOString();
  const ipHash = input.ip ? sign(`ip:${input.ip}`) : null;

  const [{ records: recent }, byIp] = await Promise.all([
    db.phone_verifications.findMany({
      select: { created_at: true },
      where: { phone, created_at: { gte: hourAgo } },
      order: { created_at: Order.Desc }
    }),
    ipHash ? db.phone_verifications.count({ where: { ip_hash: ipHash, created_at: { gte: hourAgo } } }) : 0
  ]);

  const last = recent[0] && Date.parse(recent[0].created_at);

  if (last && now - last < RESEND_WAIT_SECONDS * 1000) {
    throw new WebOrderError(WebOrderErrorCode.ResendWait, 'Wait before asking for another code');
  }

  if (recent.length >= MAX_CODES_PER_PHONE || byIp >= MAX_CODES_PER_IP) {
    throw new WebOrderError(WebOrderErrorCode.TooManyCodes, 'Too many codes this hour');
  }

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  await db.phone_verifications.insertOne({
    data: {
      id,
      store_id: storeId,
      phone,
      code_hash: sign(`code:${id}:${code}`),
      attempts: 0,
      ip_hash: ipHash,
      expires_at: new Date(now + CODE_TTL_SECONDS * 1000).toISOString(),
      created_at: new Date(now).toISOString()
    }
  });

  let messageId: string | undefined;

  try {
    messageId = await send(phone, code);
  } catch (error) {
    // Not sent: it must not hold the countdown or count against the hour.
    await db.phone_verifications.deleteOne({ where: { id } });

    if (error instanceof OtpSendError) {
      throw new WebOrderError(WebOrderErrorCode.CodeSendFailed, error.message);
    }

    throw error;
  }

  if (messageId) {
    await db.phone_verifications.updateOne({
      data: { message_id: messageId, delivery_status: 'sent' },
      where: { id }
    });
  }

  return { code };
};

/**
 * Checks the phone's latest code from this store. Every try counts (row locked, so parallel guesses cannot skip the
 * limit). Returns the browser token that skips the code for `PHONE_TOKEN_DAYS`.
 */
export const verifyPhoneCode = async (db: DbClient, storeId: string, input: { phone: string; code: string }) => {
  const phone = validPhone(input.phone);

  const {
    records: [latest]
  } = await db.phone_verifications.findMany({
    select: { id: true, code_hash: true, expires_at: true, verified_at: true },
    where: { phone, store_id: storeId },
    order: { created_at: Order.Desc },
    take: 1
  });

  if (!latest || latest.verified_at || Date.parse(latest.expires_at) <= Date.now()) {
    throw new WebOrderError(WebOrderErrorCode.CodeExpired, 'No valid code for this phone');
  }

  // Locked read + write: Ez4's conditional `updateMany` is not atomic under concurrent requests.
  const counted = await db.transaction(async (tx) => {
    const row = await tx.phone_verifications.findOne({
      select: { attempts: true },
      where: { id: latest.id },
      lock: true
    });

    if (!row || row.attempts >= MAX_ATTEMPTS) {
      return false;
    }

    await tx.phone_verifications.updateOne({ data: { attempts: row.attempts + 1 }, where: { id: latest.id } });

    return true;
  });

  if (!counted) {
    throw new WebOrderError(WebOrderErrorCode.TooManyAttempts, 'Too many tries for this code');
  }

  if (!isValidSecret(latest.code_hash, sign(`code:${latest.id}:${input.code.trim()}`))) {
    throw new WebOrderError(WebOrderErrorCode.CodeInvalid, 'Wrong code');
  }

  await db.phone_verifications.updateOne({
    data: { verified_at: new Date().toISOString() },
    where: { id: latest.id }
  });

  return { token: phoneToken(phone, Date.now() + PHONE_TOKEN_DAYS * 24 * HOUR_MS) };
};

/**
 * `<phone>.<expires epoch s>.<signature>`: stateless, so it cannot be revoked before it expires (only by changing the
 * secret, which signs every browser out).
 */
export const phoneToken = (phone: string, expiresAtMs: number) => {
  const payload = `${phone}.${Math.floor(expiresAtMs / 1000)}`;

  return `${payload}.${sign(`token:${payload}`)}`;
};

/**
 * True when the token was signed by us for this phone and has not expired.
 */
export const isPhoneVerified = (typedPhone: string, token: string | null | undefined) => {
  const phone = normalizePhone(typedPhone);
  const [tokenPhone, expires, signature] = token?.split('.') ?? [];

  if (!phone || tokenPhone !== phone || !expires || !signature || Number(expires) * 1000 <= Date.now()) {
    return false;
  }

  return isValidSecret(sign(`token:${tokenPhone}.${expires}`), signature);
};

/**
 * Ties the phone's latest unused verification to the order it allowed (codes left without an order are our cost).
 */
export const linkVerificationToOrder = async (db: DbClient, phone: string, orderId: string) => {
  const {
    records: [verification]
  } = await db.phone_verifications.findMany({
    select: { id: true },
    where: { phone, verified_at: { isNull: false }, order_id: { isNull: true } },
    order: { created_at: Order.Desc },
    take: 1
  });

  if (verification) {
    await db.phone_verifications.updateOne({ data: { order_id: orderId }, where: { id: verification.id } });
  }
};

export type OtpDeliveryStatus = { id: string; status: string; error: string | null };

/**
 * Later statuses never step back (webhooks may arrive out of order); `failed` is final.
 */
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * Meta's delivery statuses for our codes (webhook). Unknown message ids (other numbers, old rows) are ignored.
 */
export const recordOtpDeliveries = async (db: DbClient, statuses: OtpDeliveryStatus[]) => {
  for (const { id, status, error } of statuses) {
    const rank = STATUS_RANK[status];

    if (!rank) {
      continue;
    }

    const {
      records: [row]
    } = await db.phone_verifications.findMany({
      select: { id: true, delivery_status: true },
      where: { message_id: id },
      take: 1
    });

    if (!row || (STATUS_RANK[row.delivery_status ?? ''] ?? 0) >= rank) {
      continue;
    }

    await db.phone_verifications.updateOne({
      data: { delivery_status: status, delivery_error: status === 'failed' ? error : null },
      where: { id: row.id }
    });
  }
};
