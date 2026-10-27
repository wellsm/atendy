import type { Db } from '../../src/db';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { parseImport } from '../../src/prospecting/import';
import { ProspectingRepository } from '../../src/prospecting/repository';
import { runSend, SendOutcome } from '../../src/prospecting/send';
import { ProspectPauseReason, ProspectStatus } from '../../src/prospecting/types';

type Call = { url: string; apikey?: string; body: { number: string; text: string; delay: number } };

const ALL_STATUSES = [
  ProspectStatus.Queued,
  ProspectStatus.Sending,
  ProspectStatus.Sent,
  ProspectStatus.Delivered,
  ProspectStatus.Read,
  ProspectStatus.Replied,
  ProspectStatus.Failed,
  ProspectStatus.Canceled,
  ProspectStatus.Manual
];

describe('prospecting send', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const env = { EVOLUTION_API_URL: 'http://evo' };

  // Wednesday 12:00 in Brazil.
  const now = new Date('2026-10-21T15:00:00.000Z');

  const random = () => 0.5;

  let seq = 0;

  const lead = () => {
    seq++;
    return {
      name: `Pizzaria ${seq}`,
      phone: `119${String(70000000 + seq)}`,
      messages: ['Oi, tudo bem?', 'Oi! Aqui é o Well.'],
      info: {}
    };
  };

  // Imports land as `available`: queue them, as the admin does.
  const addLeads = async (count: number) => {
    await ProspectingRepository.importLeads(db, parseImport({ leads: Array.from({ length: count }, lead) }), now);

    const { records } = await db.prospect_leads.findMany({
      select: { id: true },
      where: { status: ProspectStatus.Available }
    });

    await ProspectingRepository.bulkSetStatus(
      db,
      records.map((record) => record.id),
      ProspectStatus.Queued,
      now
    );
  };

  const fetchCalls = (status = 200, body: unknown = { key: { id: 'wamid1' } }) => {
    const calls: Call[] = [];

    mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
      calls.push({
        url,
        apikey: (init.headers as Record<string, string>).apikey,
        body: JSON.parse(init.body as string) as Call['body']
      });

      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    });

    return calls;
  };

  // Evolution 2.3.0 answers a number without WhatsApp with its BadRequestException (`sendMessageWithTyping`).
  const notOnWhatsApp = (phone: string) => ({
    status: 400,
    error: 'Bad Request',
    response: { message: [{ jid: `${phone}@s.whatsapp.net`, exists: false, number: phone }] }
  });

  const failures = async () => (await ProspectingRepository.getSender(db)).consecutiveFailures;

  const leadsBy = async (status: ProspectStatus) => {
    const { records } = await db.prospect_leads.findMany({
      select: { id: true, phone: true, sent_message: true, provider_message_id: true, failure_reason: true },
      where: { status }
    });

    return records;
  };

  beforeEach(async () => {
    await db.prospect_leads.deleteMany({
      where: { status: { isIn: ALL_STATUSES } }
    });

    await ProspectingRepository.setSenderState(db, {
      instance: 'atd_prospecting_test',
      token: 'sender-token',
      connected: true,
      paused: false,
      pauseReason: null,
      nextSendAt: null,
      consecutiveFailures: 0,
      firstSentAt: null
    });

    await db.prospecting_sender.updateOne({ data: { brake_since: null }, where: { id: 'default' } });
  });

  afterEach(() => mock.restoreAll());

  it('stops when paused', async () => {
    await addLeads(1);
    await ProspectingRepository.setSenderState(db, { paused: true });
    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.Paused);
    equal(calls.length, 0);
  });

  it('stops when disconnected', async () => {
    await addLeads(1);
    await ProspectingRepository.setSenderState(db, { connected: false });
    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.Paused);
    equal(calls.length, 0);
  });

  it('waits for next_send_at', async () => {
    await addLeads(1);
    await ProspectingRepository.setSenderState(db, { nextSendAt: new Date(now.getTime() + 1000).toISOString() });
    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.Waiting);
    equal(calls.length, 0);
  });

  it('schedules the next window start plus jitter on a Sunday', async () => {
    await addLeads(1);
    const calls = fetchCalls();
    const sunday = new Date('2026-10-25T15:00:00.000Z');

    equal(await runSend(db, env, sunday, random), SendOutcome.OutsideWindow);
    equal(calls.length, 0);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.nextSendAt && new Date(sender.nextSendAt).toISOString(), '2026-10-26T13:10:00.000Z');
  });

  it('stops at the daily cap and schedules the next window day', async () => {
    await addLeads(25);
    fetchCalls();

    await db.prospect_leads.updateMany({
      data: { status: ProspectStatus.Sent, sent_at: '2026-10-21T14:00:00.000Z' },
      where: { status: ProspectStatus.Queued, position: { lte: Number.MAX_SAFE_INTEGER } }
    });

    // Only 20 of them count as today's sends; the other 5 return to the queue.
    const sent = await leadsBy(ProspectStatus.Sent);

    await db.prospect_leads.updateMany({
      data: { status: ProspectStatus.Queued, sent_at: null },
      where: { id: { isIn: sent.slice(20).map((item) => item.id) } }
    });

    await ProspectingRepository.setSenderState(db, { firstSentAt: '2026-10-21T14:00:00.000Z' });

    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.CapReached);
    equal(calls.length, 0);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.nextSendAt && new Date(sender.nextSendAt).toISOString(), '2026-10-22T13:10:00.000Z');
  });

  it('is empty without a queued lead', async () => {
    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.Empty);
    equal(calls.length, 0);
  });

  it('sends one message, records it and schedules the next gap', async () => {
    await addLeads(2);
    const calls = fetchCalls();

    equal(await runSend(db, env, now, random), SendOutcome.Sent);
    equal(calls.length, 1);
    equal(calls[0]!.url, 'http://evo/message/sendText/atd_prospecting_test');
    equal(calls[0]!.apikey, 'sender-token');
    equal(calls[0]!.body.delay, 3_500);

    const [sent] = await leadsBy(ProspectStatus.Sent);

    equal(sent!.phone, calls[0]!.body.number);
    equal(sent!.sent_message, calls[0]!.body.text);
    ok(['Oi, tudo bem?', 'Oi! Aqui é o Well.'].includes(calls[0]!.body.text));
    equal(sent!.provider_message_id, 'wamid1');
    equal((await leadsBy(ProspectStatus.Queued)).length, 1);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.nextSendAt && new Date(sender.nextSendAt).getTime(), now.getTime() + 240_000);
    equal(sender.firstSentAt && new Date(sender.firstSentAt).getTime(), now.getTime());

    // The gap blocks an immediate second run.
    equal(await runSend(db, env, now, random), SendOutcome.Waiting);
    equal(calls.length, 1);
  });

  it('sends once when two runs overlap', async () => {
    for (let round = 0; round < 5; round++) {
      await db.prospect_leads.deleteMany({ where: { status: { isIn: ALL_STATUSES } } });
      await ProspectingRepository.setSenderState(db, { nextSendAt: null, firstSentAt: null });
      await addLeads(2);

      const calls = fetchCalls();
      const outcomes = await Promise.all([runSend(db, env, now, random), runSend(db, env, now, random)]);

      equal(calls.length, 1);
      equal((await leadsBy(ProspectStatus.Sent)).length, 1);
      equal(outcomes.filter((outcome) => outcome === SendOutcome.Sent).length, 1);

      mock.restoreAll();
    }
  });

  it('sets first_sent_at on the first send only', async () => {
    await addLeads(2);
    fetchCalls();

    await runSend(db, env, now, random);

    const later = new Date(now.getTime() + 300_000);

    await runSend(db, env, later, random);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.firstSentAt && new Date(sender.firstSentAt).getTime(), now.getTime());
  });

  it('fails the lead on a permanent error, counts failures, pauses on the third and resets on success', async () => {
    await addLeads(8);
    fetchCalls(400, {});

    equal(await runSend(db, env, now, random), SendOutcome.Failed);

    const [failed] = await leadsBy(ProspectStatus.Failed);

    ok(failed!.failure_reason);
    equal(await failures(), 1);

    // A failed lead is not retried.
    await runSend(db, env, new Date(now.getTime() + 400_000), random);
    equal((await leadsBy(ProspectStatus.Failed)).length, 2);
    equal((await ProspectingRepository.getSender(db)).paused, false);

    mock.restoreAll();
    fetchCalls();
    equal(await runSend(db, env, new Date(now.getTime() + 800_000), random), SendOutcome.Sent);
    equal(await failures(), 0);

    mock.restoreAll();
    fetchCalls(400, {});

    for (const step of [1, 2, 3]) {
      await runSend(db, env, new Date(now.getTime() + 800_000 + step * 400_000), random);
    }

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.paused, true);
    equal(sender.pauseReason, ProspectPauseReason.Failures);
  });

  it('leaves the lead sending on an ambiguous error and counts the failure', async () => {
    await addLeads(2);
    fetchCalls(500, {});

    equal(await runSend(db, env, now, random), SendOutcome.Failed);

    equal((await leadsBy(ProspectStatus.Sending)).length, 1);
    equal((await leadsBy(ProspectStatus.Failed)).length, 0);
    equal((await leadsBy(ProspectStatus.Queued)).length, 1);
    equal(await failures(), 1);

    // A 200 without a message id may have delivered it too.
    mock.restoreAll();
    fetchCalls(200, {});

    equal(await runSend(db, env, new Date(now.getTime() + 400_000), random), SendOutcome.Failed);
    equal((await leadsBy(ProspectStatus.Sending)).length, 2);
    equal(await failures(), 2);
  });

  it('leaves the lead sending on a network error', async () => {
    await addLeads(1);
    mock.method(globalThis, 'fetch', () => Promise.reject(new TypeError('fetch failed')));

    equal(await runSend(db, env, now, random), SendOutcome.Failed);
    equal((await leadsBy(ProspectStatus.Sending)).length, 1);
    equal(await failures(), 1);
  });

  it('pauses after three mixed failures', async () => {
    await addLeads(4);

    const steps: [number, unknown][] = [
      [500, {}],
      [400, {}],
      [200, {}]
    ];

    for (const [index, [status, body]] of steps.entries()) {
      mock.restoreAll();
      fetchCalls(status, body);
      equal(await runSend(db, env, new Date(now.getTime() + index * 400_000), random), SendOutcome.Failed);
    }

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.consecutiveFailures, 3);
    equal(sender.paused, true);
    equal(sender.pauseReason, ProspectPauseReason.Failures);
    equal((await leadsBy(ProspectStatus.Sending)).length, 2);
    equal((await leadsBy(ProspectStatus.Failed)).length, 1);
  });

  it('fails a number without WhatsApp without counting it toward the failure pause', async () => {
    await addLeads(4);
    await ProspectingRepository.setSenderState(db, { consecutiveFailures: 2 });

    for (const step of [0, 1, 2]) {
      mock.restoreAll();
      fetchCalls(400, notOnWhatsApp('5511970000000'));
      equal(await runSend(db, env, new Date(now.getTime() + step * 400_000), random), SendOutcome.Failed);
    }

    const failed = await leadsBy(ProspectStatus.Failed);

    equal(failed.length, 3);
    deepEqual(
      failed.map((item) => item.failure_reason),
      ['Número sem WhatsApp', 'Número sem WhatsApp', 'Número sem WhatsApp']
    );

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.consecutiveFailures, 2);
    equal(sender.paused, false);
  });

  it('brakes on low replies without sending, then sends after a resume', async () => {
    await addLeads(32);
    const calls = fetchCalls();
    const old = '2026-10-19T12:00:00.000Z';

    const { records } = await db.prospect_leads.findMany({
      select: { id: true },
      where: { status: ProspectStatus.Queued },
      take: 30
    });

    await ProspectingRepository.setSenderState(db, { firstSentAt: old });

    await db.prospect_leads.updateMany({
      data: { status: ProspectStatus.Sent, sent_at: old },
      where: { id: { isIn: records.map((record) => record.id) } }
    });

    await db.prospect_leads.updateOne({
      data: { status: ProspectStatus.Replied },
      where: { id: records[0]!.id }
    });

    equal(await runSend(db, env, now, random), SendOutcome.Braked);
    equal(calls.length, 0);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.paused, true);
    equal(sender.pauseReason, ProspectPauseReason.LowReplies);

    await ProspectingRepository.updateSender(db, { paused: false }, now);
    await ProspectingRepository.setSenderState(db, { nextSendAt: null });

    equal(await runSend(db, env, new Date(now.getTime() + 1000), random), SendOutcome.Sent);
    equal(calls.length, 1);
    deepEqual((await leadsBy(ProspectStatus.Queued)).length, 1);
  });
});
