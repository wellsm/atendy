import type { Db } from '../../src/db';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpUnauthorizedError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';
import { QueueTester } from '@ez4/local-queue/test';

import { prospectingWebhookHandler } from '../../src/prospecting/endpoints/webhook';
import { parseImport } from '../../src/prospecting/import';
import { ProspectingRepository } from '../../src/prospecting/repository';
import { ProspectPauseReason, ProspectStatus } from '../../src/prospecting/types';

describe('prospecting webhook', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const instance = 'atd_prospecting';
  const sentAt = new Date('2026-10-21T15:00:00.000Z');

  let seq = 0;

  const call = async (body: unknown, secret?: string) => {
    const sender = await ProspectingRepository.getSender(db);

    return prospectingWebhookHandler(
      { headers: { authorization: secret === undefined ? sender.webhookSecret : secret }, body } as never,
      { db }
    );
  };

  const setup = async () => {
    await ProspectingRepository.setSenderState(db, { instance });
  };

  const sentLead = async () => {
    seq++;
    const phone = `119${String(70000000 + seq)}`;

    await ProspectingRepository.importLeads(
      db,
      parseImport({
        leads: [{ name: `Webhook ${seq}`, phone, messages: ['Oi, tudo bem?', 'Oi! Aqui é o Well.'] }]
      }),
      sentAt
    );

    const lead = await db.prospect_leads.findMany({
      select: { id: true, phone: true },
      where: { name: `Webhook ${seq}` },
      take: 1
    });

    const { id } = lead.records[0]!;

    await ProspectingRepository.markSent(db, id, { text: 'Oi', providerMessageId: `WH${seq}`, at: sentAt });

    return { id, phone: lead.records[0]!.phone, providerMessageId: `WH${seq}` };
  };

  const statusOf = async (id: string) =>
    (await db.prospect_leads.findOne({ select: { status: true }, where: { id } }))!.status;

  const inbound = (phone: string, at: Date) => ({
    event: 'messages.upsert',
    instance,
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `IN${seq}` },
      message: { conversation: 'oi' },
      messageTimestamp: Math.floor(at.getTime() / 1000)
    }
  });

  const ack = (providerMessageId: string, status: string) => ({
    event: 'messages.update',
    instance,
    data: { keyId: providerMessageId, status }
  });

  const connection = (state: string) => ({ event: 'connection.update', instance, data: { state } });

  it('rejects a wrong or missing authorization and an event for another instance', async () => {
    await setup();

    await rejects(call(connection('open'), 'wrong'), HttpUnauthorizedError);
    await rejects(call(connection('open'), ''), HttpUnauthorizedError);
    await rejects(call({ ...connection('open'), instance: 'atd_other' }), HttpUnauthorizedError);
  });

  it('marks a lead replied only when the reply comes after the send', async () => {
    await setup();

    const late = await sentLead();
    const response = await call(inbound(late.phone, new Date(sentAt.getTime() + 60_000)));

    equal(response.status, 200);
    equal(await statusOf(late.id), ProspectStatus.Replied);

    const early = await sentLead();

    await call(inbound(early.phone, new Date(sentAt.getTime() - 60_000)));
    equal(await statusOf(early.id), ProspectStatus.Sent);
  });

  it('answers 200 and changes nothing for an unknown phone', async () => {
    await setup();

    const lead = await sentLead();
    const response = await call(inbound('11911112222', new Date(sentAt.getTime() + 60_000)));

    equal(response.status, 200);
    equal(await statusOf(lead.id), ProspectStatus.Sent);
  });

  it('moves acks forward only and never back from replied', async () => {
    await setup();

    const lead = await sentLead();

    await call(ack(lead.providerMessageId, 'READ'));
    await call(ack(lead.providerMessageId, 'DELIVERY_ACK'));
    equal(await statusOf(lead.id), ProspectStatus.Read);

    await call(inbound(lead.phone, new Date(sentAt.getTime() + 60_000)));
    await call(ack(lead.providerMessageId, 'READ'));
    equal(await statusOf(lead.id), ProspectStatus.Replied);
  });

  it('pauses on close and only marks connected on open', async () => {
    await setup();

    await call(connection('close'));

    let sender = await ProspectingRepository.getSender(db);
    equal(sender.connected, false);
    equal(sender.paused, true);
    equal(sender.pauseReason, ProspectPauseReason.Disconnected);

    await call(connection('connecting'));

    sender = await ProspectingRepository.getSender(db);
    equal(sender.connected, false);

    await call(connection('open'));

    sender = await ProspectingRepository.getSender(db);
    equal(sender.connected, true);
    equal(sender.paused, true);
  });

  it('never reaches store conversations or the inbound queue', async () => {
    await setup();

    const lead = await sentLead();

    await call(inbound(lead.phone, new Date(sentAt.getTime() + 60_000)));
    await call(connection('open'));

    const inboundQueue = QueueTester.getClientMock('InboundQueue');

    equal(inboundQueue.sendMessage.mock.callCount(), 0);

    const phones = { isIn: [lead.phone, lead.phone.slice(2)] };
    const customers = await db.customers.findMany({ select: { id: true }, where: { phone: phones }, take: 1 });

    deepEqual(customers.records, []);
  });
});
