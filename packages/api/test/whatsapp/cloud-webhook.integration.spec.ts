import type { Db } from '../../src/db';

import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { sendPhoneCode } from '../../src/storefront/phone-code';
import {
  verifyWhatsAppCloudWebhookHandler,
  whatsAppCloudWebhookHandler
} from '../../src/whatsapp/endpoints/cloud-webhook';
import { seedStore } from '../support/fixtures';

describe('WhatsApp Cloud API webhook (code delivery)', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const statusEvent = (id: string, status: string, errors?: object[]) => ({
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status, ...(errors && { errors }) }] } }] }]
  });

  const call = (body: object, secret = 'app-secret') => {
    const data = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(data).digest('hex')}`;

    return whatsAppCloudWebhookHandler({ headers: { 'x-hub-signature-256': signature }, body, data } as never, { db });
  };

  const sentCode = async () => {
    const { storeId } = await seedStore(db);
    const messageId = `wamid.${randomUUID()}`;
    const phone = `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

    await sendPhoneCode(db, storeId, { phone, ip: undefined }, () => Promise.resolve(messageId));

    const delivery = async () =>
      (
        await db.phone_verifications.findMany({
          select: { delivery_status: true, delivery_error: true },
          where: { message_id: messageId }
        })
      ).records[0];

    return { messageId, delivery };
  };

  it('answers Meta’s check only with the verify token', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': '12345' };

    equal(verifyWhatsAppCloudWebhookHandler({ query } as never, {} as never).body, '12345');

    throws(
      () =>
        verifyWhatsAppCloudWebhookHandler({ query: { ...query, 'hub.verify_token': 'nope' } } as never, {} as never),
      HttpForbiddenError
    );
  });

  it('refuses calls not signed with the app secret', async () => {
    const { messageId, delivery } = await sentCode();

    await rejects(call(statusEvent(messageId, 'delivered'), 'other'), HttpUnauthorizedError);
    deepEqual(await delivery(), { delivery_status: 'sent', delivery_error: null });
  });

  it('keeps the latest status (never back) and the reason of a failure', async () => {
    const delivered = await sentCode();

    await call(statusEvent(delivered.messageId, 'read'));
    await call(statusEvent(delivered.messageId, 'delivered'));

    deepEqual(await delivered.delivery(), { delivery_status: 'read', delivery_error: null });

    const failed = await sentCode();

    await call(
      statusEvent(failed.messageId, 'failed', [
        { code: 131037, title: 'Display name approval required', error_data: { details: 'Name pending' } }
      ])
    );

    deepEqual(await failed.delivery(), { delivery_status: 'failed', delivery_error: '131037 Name pending' });

    // Unknown messages are ignored, still 200.
    equal((await call(statusEvent('wamid.unknown', 'delivered'))).status, 200);
  });
});
