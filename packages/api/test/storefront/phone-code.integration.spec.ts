import type { HttpError } from '@ez4/gateway';
import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpForbiddenError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { createWebOrderHandler } from '../../src/storefront/endpoints/create-order';
import { sendPhoneCodeHandler } from '../../src/storefront/endpoints/send-phone-code';
import { verifyPhoneCodeHandler } from '../../src/storefront/endpoints/verify-phone-code';
import { isPhoneVerified, phoneToken, sendPhoneCode, verifyPhoneCode } from '../../src/storefront/phone-code';
import { WebOrderErrorCode } from '../../src/storefront/web-order';
import { OTP_TEMPLATE, OtpSendError } from '../../src/storefront/whatsapp-otp';
import { groupIdOf, optionIdOf, productByName, seedMenu, seedStore } from '../support/fixtures';

/**
 * Codes are limited per phone across stores and tests share the database: every test gets its own number.
 */
const newPhone = () => {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return { typed: `(11) 9${digits.slice(0, 4)}-${digits.slice(4)}`, normalized: `55119${digits}` };
};

const rejectsWith = (promise: Promise<unknown>, status: number, field: WebOrderErrorCode) =>
  rejects(promise, (error: HttpError) => {
    equal(error.status, status);
    deepEqual(error.context, { field });
    return true;
  });

describe('web order phone codes', () => {
  const db = DatabaseTester.getClient<Db>('Db');
  // Ez4 restores client mocks after each test: take a fresh one per test.
  let panelEvents = QueueTester.getClientMock('PanelEventsQueue');

  beforeEach(() => {
    panelEvents = QueueTester.getClientMock('PanelEventsQueue');
  });

  afterEach(() => mock.restoreAll());

  const setup = async () => {
    const { storeId } = await seedStore(db, { flat_fee_cents: 500 });
    const menu = await seedMenu(db, storeId);
    const slug = `t-${storeId}`;
    const phone = newPhone();
    const sent: { url: string; body: Record<string, unknown> }[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const send = (typed = phone.typed, ip = '10.0.0.1') =>
      sendPhoneCodeHandler(
        { parameters: { slug }, headers: { 'x-forwarded-for': `1.1.1.1, ${ip}` }, body: { phone: typed } } as never,
        { db }
      );

    const verify = (code: string, typed = phone.typed) =>
      verifyPhoneCodeHandler({ parameters: { slug }, body: { phone: typed, code } } as never, { db });

    // The code that went out in the last WhatsApp template.
    const lastCode = () => {
      const template = sent.at(-1)!.body.template as { components: { parameters: { text: string }[] }[] };
      return template.components[0]!.parameters[0]!.text;
    };

    return { storeId, slug, menu, phone, sent, send, verify, lastCode };
  };

  it('sends the authentication template from our number and waits 59 s before another code', async () => {
    const { phone, send, sent, lastCode } = await setup();

    const { body } = await send();

    equal(body.resendInSeconds, 59);
    equal(body.expiresInSeconds, 600);
    equal(body.localCode, null);
    equal(sent[0]!.url, 'https://graph.facebook.com/v23.0/otp-phone/messages');
    equal(sent[0]!.body.to, phone.normalized);
    equal((sent[0]!.body.template as { name: string }).name, OTP_TEMPLATE);
    ok(/^\d{6}$/.test(lastCode()));

    await rejectsWith(send(), 429, WebOrderErrorCode.ResendWait);
  });

  it('limits codes per phone and per IP in the hour', async () => {
    const { storeId, send } = await setup();
    const busy = newPhone();
    const ip = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    for (const minutes of [50, 30, 10]) {
      await db.phone_verifications.insertOne({
        data: {
          id: crypto.randomUUID(),
          store_id: storeId,
          phone: busy.normalized,
          code_hash: 'x',
          attempts: 0,
          expires_at: minutesAgo(minutes - 10),
          created_at: minutesAgo(minutes)
        }
      });
    }

    await rejectsWith(send(busy.typed), 429, WebOrderErrorCode.TooManyCodes);

    for (let index = 0; index < 10; index++) {
      await send(newPhone().typed, ip);
    }

    const last = newPhone().typed;

    await rejectsWith(send(last, ip), 429, WebOrderErrorCode.TooManyCodes);
    await send(last, `${ip}0`);
  });

  it('counts every try, gives a token for the right code and uses each code once', async () => {
    const { phone, send, verify, lastCode } = await setup();

    await send();

    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';

    await rejectsWith(verify(wrong), 400, WebOrderErrorCode.CodeInvalid);

    const { body } = await verify(code);

    ok(isPhoneVerified(phone.typed, body.token));
    ok(!isPhoneVerified(newPhone().typed, body.token));
    ok(!isPhoneVerified(phone.typed, `${body.token}x`));
    ok(!isPhoneVerified(phone.typed, phoneToken(phone.normalized, Date.now() - 1000)));

    await rejectsWith(verify(code), 400, WebOrderErrorCode.CodeExpired);
  });

  it('blocks the code after 5 wrong tries, even the right one, also when they come in parallel', async () => {
    const { storeId, phone } = await setup();
    let code = '';

    await sendPhoneCode(db, storeId, { phone: phone.normalized, ip: undefined }, (_phone, sentCode) => {
      code = sentCode;
      return Promise.resolve(undefined);
    });

    const wrong = code === '000000' ? '111111' : '000000';
    const tries = await Promise.allSettled(
      Array.from({ length: 8 }, () => verifyPhoneCode(db, storeId, { phone: phone.normalized, code: wrong }))
    );

    equal(
      tries.filter(
        (result) =>
          result.status === 'rejected' && (result.reason as { code: string }).code === WebOrderErrorCode.TooManyAttempts
      ).length,
      3
    );

    await rejects(verifyPhoneCode(db, storeId, { phone: phone.normalized, code }), {
      code: WebOrderErrorCode.TooManyAttempts
    });
  });

  it('forgets a code WhatsApp did not send (no countdown, no hour quota)', async () => {
    const { storeId, phone } = await setup();

    await rejects(
      sendPhoneCode(db, storeId, { phone: phone.normalized, ip: undefined }, () =>
        Promise.reject(new OtpSendError('down'))
      ),
      { code: WebOrderErrorCode.CodeSendFailed }
    );

    equal(await db.phone_verifications.count({ where: { phone: phone.normalized } }), 0);
  });

  it('returns the code to the checkout only in local mode', async () => {
    const { send, sent } = await setup();
    const previous = process.env.WHATSAPP_OTP_PHONE_ID;

    process.env.WHATSAPP_OTP_PHONE_ID = 'local';

    try {
      const { body } = await send();

      ok(/^\d{6}$/.test(body.localCode ?? ''));
      equal(sent.length, 0);
    } finally {
      process.env.WHATSAPP_OTP_PHONE_ID = previous;
    }
  });

  it('takes web orders only from a verified phone and ties the code to the order', async () => {
    const { storeId, slug, menu, phone, send, verify, lastCode } = await setup();
    const broto = productByName(menu, 'Pizza Broto');

    const order = (token: string | null) =>
      createWebOrderHandler(
        {
          parameters: { slug },
          body: {
            name: 'Ana',
            phone: phone.typed,
            phoneToken: token,
            items: [
              {
                productId: broto.id,
                qty: 1,
                selections: [
                  { groupId: groupIdOf(broto, 'Sabor'), optionIds: [optionIdOf(broto, 'Sabor', 'Calabresa')] }
                ]
              }
            ],
            delivery: { fulfillment: 'pickup' },
            payment: { method: 'pix' }
          }
        } as never,
        { db, panelEvents }
      );

    await rejects(order(null), HttpForbiddenError);
    await rejects(order(phoneToken(newPhone().normalized, Date.now() + 60_000)), HttpForbiddenError);

    await send();

    const { body } = await verify(lastCode());

    await order(body.token);

    const [placed] = (await db.orders.findMany({ select: { id: true }, where: { store_id: storeId } })).records;
    const [verification] = (
      await db.phone_verifications.findMany({ select: { order_id: true }, where: { phone: phone.normalized } })
    ).records;

    equal(verification?.order_id, placed?.id);
  });
});
