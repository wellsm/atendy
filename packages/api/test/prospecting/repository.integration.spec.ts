import type { Db } from '../../src/db';

import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { parseImport } from '../../src/prospecting/import';
import { ProspectingRepository, ProspectStatusError } from '../../src/prospecting/repository';
import { ProspectPauseReason, ProspectSituation, ProspectStatus } from '../../src/prospecting/types';

describe('prospecting repository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const now = new Date('2026-10-21T15:00:00.000Z');

  let seq = 0;

  // Unique phones per call so specs never collide on the unique phone index.
  const row = (phone?: string, name = 'Pizzaria') => {
    seq++;
    return {
      name: `${name} ${seq}`,
      phone: phone ?? `119${String(80000000 + seq)}`,
      messages: ['Oi, tudo bem?', 'Oi! Aqui é o Well.'],
      info: { bairro: 'Penha' }
    };
  };

  const importRows = (...rows: ReturnType<typeof row>[]) =>
    ProspectingRepository.importLeads(db, parseImport({ leads: rows }), now);

  const select = {
    id: true,
    phone: true,
    status: true,
    position: true,
    sent_message: true,
    sent_at: true
  } as const;

  const findLead = async (id: string) => {
    const lead = await db.prospect_leads.findOne({ select, where: { id } });
    ok(lead);
    return lead;
  };

  const byName = async (name: string) =>
    (await db.prospect_leads.findMany({ select, where: { name }, take: 1 })).records[0]!;

  const setLead = (id: string, data: Record<string, unknown>) =>
    db.prospect_leads.updateOne({ data: data, where: { id } });

  // Isolates a claimNext test from leads queued by other specs.
  const clearQueue = async () => {
    await ProspectingRepository.setSenderState(db, { paused: false, connected: true, nextSendAt: null });

    await db.prospect_leads.updateMany({
      data: { status: ProspectStatus.Canceled },
      where: { status: ProspectStatus.Queued }
    });
  };

  const queuedIds = async (count: number) => {
    await clearQueue();
    const added: string[] = [];
    for (let index = 0; index < count; index++) {
      const lead = row();
      await importRows(lead);
      added.push((await byName(lead.name)).id);
    }
    await ProspectingRepository.bulkSetStatus(db, added, ProspectStatus.Queued, now);
    return added;
  };

  it('creates the sender unpaused, once', async () => {
    const first = await ProspectingRepository.getSender(db);
    const second = await ProspectingRepository.getSender(db);

    equal(first.paused, false);
    equal(first.pauseReason, null);
    equal(first.maxDaily, 50);
    equal(first.window.startHour, 10);
    equal(first.webhookSecret.length, 64);
    equal(first.webhookSecret, second.webhookSecret);
  });

  it('resumes from a failures or manual pause without touching the brake mark, and pauses as manual', async () => {
    const mark = '2026-10-01T12:00:00.000Z';

    await db.prospecting_sender.updateOne({ data: { brake_since: mark }, where: { id: 'default' } });

    for (const reason of [ProspectPauseReason.Failures, ProspectPauseReason.Manual]) {
      await ProspectingRepository.setSenderState(db, { paused: true, pauseReason: reason, consecutiveFailures: 3 });

      const resumed = await ProspectingRepository.updateSender(db, { paused: false }, now);

      equal(resumed.paused, false);
      equal(resumed.pauseReason, null);
      equal(resumed.consecutiveFailures, 0);
      equal(resumed.brakeSince && new Date(resumed.brakeSince).toISOString(), mark);
    }

    const paused = await ProspectingRepository.updateSender(db, { paused: true, maxDaily: 20 }, now);

    equal(paused.paused, true);
    equal(paused.pauseReason, 'manual');
    equal(paused.maxDaily, 20);
  });

  it('starts a new brake mark when resuming from a low_replies pause', async () => {
    await db.prospecting_sender.updateOne({
      data: { brake_since: '2026-10-01T12:00:00.000Z' },
      where: { id: 'default' }
    });

    await ProspectingRepository.setSenderState(db, {
      paused: true,
      pauseReason: ProspectPauseReason.LowReplies,
      consecutiveFailures: 1
    });

    const resumed = await ProspectingRepository.updateSender(db, { paused: false }, now);

    equal(resumed.paused, false);
    equal(resumed.pauseReason, null);
    equal(resumed.consecutiveFailures, 0);
    equal(resumed.brakeSince && new Date(resumed.brakeSince).toISOString(), now.toISOString());
  });

  it('imports with continuing positions, duplicates and invalid rows', async () => {
    const a = row();
    const b = row();
    const first = await importRows(a, b);

    equal(first.added, 2);
    equal(first.total, 2);

    const leadA = await byName(a.name);
    const leadB = await byName(b.name);

    equal(leadB.position, leadA.position + 1);
    equal(leadA.status, ProspectStatus.Available);

    // `a` stored with the mobile 9; the same line without it is a duplicate.
    const without9 = `${a.phone.slice(0, 2)}${a.phone.slice(3)}`;
    const c = row();
    const second = ProspectingRepository.importLeads(
      db,
      parseImport({ leads: [{ ...row(without9) }, c, { name: '', phone: '1' }, { ...c }] }),
      now
    );
    const result = await second;

    equal(result.added, 1);
    equal(result.skippedDuplicate, 2);
    equal(result.skippedInvalid, 1);
    equal(result.errors.length, 1);
    equal(result.total, 4);

    const leadC = await byName(c.name);
    equal(leadC.position, leadB.position + 1);

    const stored = await db.prospect_imports.findOne({
      select: { added: true, skipped_duplicate: true, skipped_invalid: true, total: true },
      where: { id: result.importId }
    });

    equal(stored?.added, 1);
    equal(stored?.skipped_duplicate, 2);
    equal(stored?.skipped_invalid, 1);
    equal(stored?.total, 4);
  });

  it('stores the import details as columns and nulls for a plain file', async () => {
    const plain = row();
    const rich = {
      ...row(),
      category: 'Pizzaria',
      neighborhood: 'Penha',
      zone: 'Zona Leste',
      city: 'São Paulo',
      postal_code: '03600-000',
      situation: 'competitor',
      systems: [{ name: 'Goomer', kind: 'market' }],
      rating: 4.5,
      reviews: 120,
      score: 8,
      site: 'pizzaria.example',
      mobile: true
    };

    await importRows(plain, rich);

    const full = {
      ...select,
      category: true,
      situation: true,
      systems: true,
      rating: true,
      score: true,
      queued_at: true
    };
    const read = async (name: string) =>
      (await db.prospect_leads.findMany({ select: full, where: { name }, take: 1 })).records[0]!;

    const empty = await read(plain.name);
    const filled = await read(rich.name);

    equal(empty.status, ProspectStatus.Available);
    equal(empty.category ?? null, null);
    equal(empty.score ?? null, null);
    equal(empty.queued_at ?? null, null);
    equal(filled.category, 'Pizzaria');
    equal(filled.situation, 'competitor');
    deepEqual(filled.systems, [{ name: 'Goomer', kind: 'market' }]);
    equal(filled.rating, 4.5);
    equal(filled.score, 8);

    const [listed] = (await ProspectingRepository.listLeads(db, { q: rich.name, limit: 1 }, now)).leads;

    equal(listed!.postalCode, '03600-000');
    equal(listed!.reviews, 120);
    equal(listed!.mobile, true);
    equal(listed!.queuedAt, null);
  });

  it('claims nothing while every lead is available', async () => {
    await clearQueue();
    await importRows(row());

    equal(await ProspectingRepository.claimNext(db, now, 1000), undefined);
  });

  it('claims by queued_at, then score (unscored last), then position', async () => {
    await clearQueue();

    const t1 = new Date('2026-10-21T14:00:00.000Z');
    const t2 = new Date('2026-10-21T14:30:00.000Z');
    const a = { ...row(), score: 3 };
    const b = row();
    const c = { ...row(), score: 9 };

    await importRows(a, b, c);

    const [idA, idB, idC] = [a, b, c].map((lead) => lead.name);
    const ids = await Promise.all([idA!, idB!, idC!].map(async (name) => (await byName(name)).id));

    await ProspectingRepository.bulkSetStatus(db, [ids[0]!], ProspectStatus.Queued, t1);
    await ProspectingRepository.bulkSetStatus(db, [ids[1]!, ids[2]!], ProspectStatus.Queued, t2);

    for (const expected of [ids[0], ids[2], ids[1]]) {
      const claimed = await ProspectingRepository.claimNext(db, now, 0);

      equal(claimed?.id, expected);
    }

    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);
  });

  it('sets queued_at on queueing, clears it on available, and bulk-availables failed and canceled leads', async () => {
    await clearQueue();

    const lead = row();
    await importRows(lead);
    const id = (await byName(lead.name)).id;
    const queuedAt = async () =>
      (await db.prospect_leads.findOne({ select: { queued_at: true }, where: { id } }))?.queued_at ?? null;

    const queued = await ProspectingRepository.updateLead(db, id, { status: ProspectStatus.Queued }, now);

    equal(queued.queuedAt && new Date(queued.queuedAt).toISOString(), now.toISOString());

    const back = await ProspectingRepository.updateLead(db, id, { status: ProspectStatus.Available }, now);

    equal(back.status, ProspectStatus.Available);
    equal(await queuedAt(), null);

    for (const from of [ProspectStatus.Queued, ProspectStatus.Failed, ProspectStatus.Canceled]) {
      await setLead(id, { status: from, queued_at: from === ProspectStatus.Queued ? now.toISOString() : null });

      const result = await ProspectingRepository.bulkSetStatus(db, [id], ProspectStatus.Available, now);

      equal(result.updated, 1);
      equal((await findLead(id)).status, ProspectStatus.Available);
      equal(await queuedAt(), null);
    }
  });

  it('never claims a queued lead without queued_at (legacy rows), only one queued by the admin', async () => {
    await clearQueue();

    const [legacyLead, queuedLead] = [row(), row()];
    await importRows(legacyLead, queuedLead);

    const legacyId = (await byName(legacyLead.name)).id;
    const queuedId = (await byName(queuedLead.name)).id;

    await setLead(legacyId, { status: ProspectStatus.Queued, queued_at: null });

    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);

    await ProspectingRepository.bulkSetStatus(db, [queuedId], ProspectStatus.Queued, now);

    equal((await ProspectingRepository.claimNext(db, now, 0))?.id, queuedId);
    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);
    equal((await findLead(legacyId)).status, ProspectStatus.Queued);

    await setLead(legacyId, { status: ProspectStatus.Canceled });
  });

  it('clears failure_reason when a failed lead goes back to available', async () => {
    await clearQueue();

    const lead = row();
    await importRows(lead);
    const id = (await byName(lead.name)).id;

    await setLead(id, { status: ProspectStatus.Failed, failure_reason: 'send_failed' });

    await ProspectingRepository.bulkSetStatus(db, [id], ProspectStatus.Available, now);

    const back = await db.prospect_leads.findOne({ select: { failure_reason: true, status: true }, where: { id } });

    equal(back?.status, ProspectStatus.Available);
    equal(back?.failure_reason ?? null, null);
  });

  it('claims the lowest queued lead', async () => {
    const [first, second] = await queuedIds(2);
    const claimed = await ProspectingRepository.claimNext(db, now, 0);

    equal(claimed?.id, first);
    deepEqual(claimed?.messages, ['Oi, tudo bem?', 'Oi! Aqui é o Well.']);
    equal((await findLead(first!)).status, ProspectStatus.Sending);
    equal((await findLead(second!)).status, ProspectStatus.Queued);
  });

  it('claims nothing when the locked sender is paused, disconnected or waiting, and reserves the gap', async () => {
    const [id] = await queuedIds(1);

    await ProspectingRepository.setSenderState(db, { paused: true });
    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);
    await ProspectingRepository.setSenderState(db, { paused: false, connected: false });
    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);
    await ProspectingRepository.setSenderState(db, {
      connected: true,
      nextSendAt: new Date(now.getTime() + 1000).toISOString()
    });
    equal(await ProspectingRepository.claimNext(db, now, 0), undefined);
    equal((await findLead(id!)).status, ProspectStatus.Queued);

    await ProspectingRepository.setSenderState(db, { nextSendAt: null });
    equal((await ProspectingRepository.claimNext(db, now, 240_000))?.id, id);

    const sender = await ProspectingRepository.getSender(db);

    equal(sender.nextSendAt && Date.parse(sender.nextSendAt), now.getTime() + 240_000);
  });

  it('never claims the same lead twice in parallel (2 queued)', async () => {
    const [first, second] = await queuedIds(2);
    const results = await Promise.all([
      ProspectingRepository.claimNext(db, now, 0),
      ProspectingRepository.claimNext(db, now, 0)
    ]);
    const ids = results.map((result) => result?.id).sort();

    deepEqual(ids, [first, second].sort());
  });

  it('never claims the same lead twice in parallel (1 queued)', async () => {
    const [only] = await queuedIds(1);
    const results = await Promise.all([
      ProspectingRepository.claimNext(db, now, 0),
      ProspectingRepository.claimNext(db, now, 0)
    ]);
    const ids = results.map((result) => result?.id);

    equal(ids.filter((id) => id === only).length, 1);
    equal(ids.filter((id) => id === undefined).length, 1);
  });

  it('never claims a lead the admin set to manual at the same time', async () => {
    for (let round = 0; round < 10; round++) {
      const [id] = await queuedIds(1);
      const [claimed] = await Promise.all([
        ProspectingRepository.claimNext(db, now, 0),
        ProspectingRepository.bulkSetStatus(db, [id!], ProspectStatus.Manual, now)
      ]);
      const { status } = await findLead(id!);

      if (claimed) {
        equal(claimed.id, id);
        equal(status, ProspectStatus.Sending);
      } else {
        equal(status, ProspectStatus.Manual);
      }
    }
  });

  it('stores a phone once when two imports carry its two forms at the same time', async () => {
    const suffix = String(70000000 + ++seq);
    const withNine = row(`119${suffix}`);
    const withoutNine = row(`11${suffix}`);

    const results = await Promise.all([importRows(withNine), importRows(withoutNine)]);

    equal(
      results.reduce((sum, result) => sum + result.added, 0),
      1
    );
    equal(
      results.reduce((sum, result) => sum + result.skippedDuplicate, 0),
      1
    );

    const { records } = await db.prospect_leads.findMany({
      select: { id: true },
      where: { phone: { isIn: [`55119${suffix}`, `5511${suffix}`] } }
    });

    equal(records.length, 1);
  });

  it('marks sent, moves acks forward only and stops at replied', async () => {
    const [id] = await queuedIds(1);
    await ProspectingRepository.claimNext(db, now, 0);
    await ProspectingRepository.markSent(db, id!, { text: 'Oi!', providerMessageId: 'wamid-1', at: now });

    const sent = await findLead(id!);

    equal(sent.status, ProspectStatus.Sent);
    equal(sent.sent_message, 'Oi!');
    equal(sent.sent_at, now.toISOString());

    const at = new Date(now.getTime() + 60_000);

    equal(await ProspectingRepository.markAck(db, 'wamid-1', ProspectStatus.Read, at), true);
    equal(await ProspectingRepository.markAck(db, 'wamid-1', ProspectStatus.Delivered, at), false);
    equal((await findLead(id!)).status, ProspectStatus.Read);

    equal(await ProspectingRepository.markReplied(db, sent.phone, at), true);
    equal(await ProspectingRepository.markAck(db, 'wamid-1', ProspectStatus.Read, at), false);
    equal((await findLead(id!)).status, ProspectStatus.Replied);
    equal(await ProspectingRepository.markAck(db, 'unknown', ProspectStatus.Read, at), false);
  });

  it('matches a reply from the other 9-digit form and ignores bad cases', async () => {
    const lead = row('5511987654321');
    await importRows(lead);
    const id = (await db.prospect_leads.findOne({ select, where: { phone: '5511987654321' } }))!.id;
    const at = new Date(now.getTime() + 60_000);

    equal(await ProspectingRepository.markReplied(db, '551187654321', at), false); // still queued

    await setLead(id, { status: ProspectStatus.Sent, sent_at: now.toISOString() });

    equal(await ProspectingRepository.markReplied(db, '551187654321', new Date(now.getTime() - 1000)), false);
    equal(await ProspectingRepository.markReplied(db, '551187654321', at), true);

    const manual = row();
    await importRows(manual);
    const manualId = await byName(manual.name);
    await setLead(manualId.id, { status: ProspectStatus.Manual, sent_at: now.toISOString() });

    equal(await ProspectingRepository.markReplied(db, manualId.phone, at), false);
  });

  it('counts sends by Brazil day and ignores manual leads', async () => {
    const before = await ProspectingRepository.sentOn(db, now);
    const [one, two] = await queuedIds(2);

    // 02:30Z of the 22nd is still the 21st in Brazil; 03:00Z is the 22nd.
    await setLead(one!, { status: ProspectStatus.Sent, sent_at: '2026-10-22T02:30:00.000Z' });
    await setLead(two!, { status: ProspectStatus.Manual, sent_at: '2026-10-21T15:00:00.000Z' });

    equal(await ProspectingRepository.sentOn(db, now), before + 1);

    await setLead(one!, { sent_at: '2026-10-22T03:00:00.000Z' });

    equal(await ProspectingRepository.sentOn(db, now), before);
  });

  it('samples replies older than 24h after the brake mark', async () => {
    const base = await ProspectingRepository.replySample(db, '2030-01-01T00:00:00.000Z', now);

    equal(base.sent, 0);

    const [one, two, three] = await queuedIds(3);
    await setLead(one!, { status: ProspectStatus.Replied, sent_at: '2030-01-02T00:00:00.000Z' });
    await setLead(two!, { status: ProspectStatus.Sent, sent_at: '2030-01-02T00:00:00.000Z' });
    await setLead(three!, { status: ProspectStatus.Sent, sent_at: '2030-01-04T11:00:00.000Z' });

    const later = new Date('2030-01-04T12:00:00.000Z');
    const sample = await ProspectingRepository.replySample(db, '2030-01-01T00:00:00.000Z', later);

    deepEqual(sample, { sent: 2, replied: 1 });
  });

  it('updates notes, validates transitions and frees stuck leads', async () => {
    const [id, other] = await queuedIds(2);

    const noted = await ProspectingRepository.updateLead(db, id!, { note: 'ligar depois' }, now);

    equal(noted.note, 'ligar depois');
    equal(noted.status, ProspectStatus.Queued);

    await rejects(ProspectingRepository.updateLead(db, id!, { status: ProspectStatus.Sent }, now), ProspectStatusError);

    await setLead(other!, {
      status: ProspectStatus.Sending,
      updated_at: new Date(now.getTime() - 11 * 60_000).toISOString()
    });

    const listed = await ProspectingRepository.listLeads(db, { status: ProspectStatus.Sending, limit: 50 }, now);
    const stuck = listed.leads.find((lead: { id: string }) => lead.id === other);

    equal(stuck?.stuck, true);

    const freed = await ProspectingRepository.updateLead(db, other!, { status: ProspectStatus.Queued }, now);

    equal(freed.status, ProspectStatus.Queued);
    equal(freed.stuck, false);
  });

  it('does not free a fresh sending lead', async () => {
    const [id] = await queuedIds(1);
    await setLead(id!, { status: ProspectStatus.Sending, updated_at: now.toISOString() });

    await rejects(
      ProspectingRepository.updateLead(db, id!, { status: ProspectStatus.Queued }, now),
      ProspectStatusError
    );
  });

  it('bulk sets manual only where allowed', async () => {
    const [queued, sent] = await queuedIds(2);
    await setLead(sent!, { status: ProspectStatus.Sent });

    const result = await ProspectingRepository.bulkSetStatus(db, [queued!, sent!], ProspectStatus.Manual, now);

    deepEqual(result, { updated: 1, skipped: 1 });
    equal((await findLead(queued!)).status, ProspectStatus.Manual);
    equal((await findLead(sent!)).status, ProspectStatus.Sent);
  });

  it('lists by position with cursor, search and counts', async () => {
    await clearQueue();
    const lead = row(undefined, 'Zebra');
    await importRows(lead, row(undefined, 'Zebra'), row(undefined, 'Zebra'));

    const page = await ProspectingRepository.listLeads(db, { q: 'Zebra', limit: 2 }, now);

    equal(page.leads.length, 2);
    equal(page.total, 3);
    ok(page.nextCursor);
    ok(page.leads[0]!.position < page.leads[1]!.position);

    const next = await ProspectingRepository.listLeads(db, { q: 'Zebra', limit: 2, cursor: page.nextCursor }, now);

    equal(next.leads.length, 1);
    equal(next.total, 3);
    equal(next.nextCursor, null);
    notEqual(next.leads[0]!.id, page.leads[0]!.id);

    const byPhone = await ProspectingRepository.listLeads(db, { q: page.leads[0]!.phone, limit: 5 }, now);

    equal(byPhone.leads.length, 1);
    equal(byPhone.total, 1);
    ok((await ProspectingRepository.listLeads(db, { limit: 1 }, now)).total >= 3);

    const counts = await ProspectingRepository.counts(db);

    ok(counts[ProspectStatus.Available] >= 3);
    equal(typeof counts[ProspectStatus.Manual], 'number');
  });

  it('searches names ignoring case and phones with or without 55', async () => {
    const lead = row('11943210077', 'Quokka Lanches');
    await importRows(lead);

    const names = async (q: string) =>
      (await ProspectingRepository.listLeads(db, { q, limit: 5 }, now)).leads.map((item) => item.name);

    deepEqual(await names('quokka lanches'), [lead.name]);
    deepEqual(await names('QUOKKA'), [lead.name]);
    deepEqual(await names('5511943210077'), [lead.name]);
    deepEqual(await names('11943210077'), [lead.name]);
    deepEqual(await names('(11) 94321-0077'), [lead.name]);
    deepEqual(await names('+55 11 94321'), [lead.name]);
    deepEqual(await names('21943210077'), []);
  });

  describe('filters, sort, queueBest and overview', () => {
    const tag = async (suffix: string, data: Record<string, unknown>) => {
      const lead = row(undefined, `Filt${suffix}`);
      await importRows(lead);
      const found = await byName(lead.name);
      await setLead(found.id, data);
      return found.id;
    };

    const ids = async (query: Parameters<typeof ProspectingRepository.listLeads>[1]) =>
      (await ProspectingRepository.listLeads(db, query, now)).leads.map((item) => item.id);

    it('narrows the list by each filter', async () => {
      const city = `Cidade${seq}`;
      const a = await tag('A', {
        city,
        zone: 'Zona Norte',
        neighborhood: 'Santana',
        category: 'Hamburgueria Xyz',
        situation: ProspectSituation.WhatsApp,
        mobile: true,
        systems: [{ name: 'Menudino Zed', kind: 'market' }]
      });
      const b = await tag('B', {
        city,
        zone: 'Zona Sul',
        neighborhood: 'Moema',
        category: 'Pizzaria Xyz',
        situation: ProspectSituation.None,
        mobile: false,
        status: ProspectStatus.Manual
      });
      const base = { city, limit: 50 };

      deepEqual((await ids(base)).sort(), [a, b].sort());
      deepEqual(await ids({ ...base, zone: 'Zona Norte' }), [a]);
      deepEqual(await ids({ ...base, neighborhood: 'Moema' }), [b]);
      deepEqual(await ids({ ...base, category: 'Pizzaria Xyz' }), [b]);
      deepEqual(await ids({ ...base, situation: ProspectSituation.WhatsApp }), [a]);
      deepEqual(await ids({ ...base, mobile: true }), [a]);
      deepEqual(await ids({ ...base, mobile: false }), [b]);
      deepEqual(await ids({ ...base, status: ProspectStatus.Manual }), [b]);
      deepEqual(await ids({ ...base, q: 'pizzaria xyz' }), [b]);
      deepEqual(await ids({ ...base, q: 'MENUDINO zed' }), [a]);
      deepEqual(await ids({ city: `${city}-other`, limit: 50, q: 'menudino zed' }), []);
      deepEqual(await ids({ ...base, zone: 'Zona Sul', q: 'menudino zed' }), []);
    });

    it('sorts by score (nulls last), reviews and name', async () => {
      const city = `Sort${seq}`;
      const nul = await tag('N', { city, score: null, reviews: null });
      const low = await tag('L', { city, score: 2, reviews: 500 });
      const high = await tag('H', { city, score: 9, reviews: 10 });
      const base = { city, limit: 10 };

      deepEqual(await ids({ ...base, sort: 'score' }), [high, low, nul]);
      deepEqual(await ids({ ...base }), [high, low, nul]);
      deepEqual(await ids({ ...base, sort: 'reviews' }), [low, high, nul]);

      const names = (await ProspectingRepository.listLeads(db, { ...base, sort: 'name' }, now)).leads.map(
        (item) => item.name
      );
      deepEqual(names, [...names].sort());

      // A page boundary inside the scored group and across to the unscored one.
      deepEqual(await ids({ city, limit: 2, cursor: 1, sort: 'score' }), [low, nul]);

      // An offset that starts inside the NULL group.
      const nul2 = await tag('N2', { city, score: null });
      deepEqual(await ids({ city, limit: 5, cursor: 3, sort: 'score' }), [nul2]);
      deepEqual(await ids({ city, limit: 1, cursor: 3, sort: 'score' }), [nul2]);
    });

    it('pages equal scores without repeats', async () => {
      const city = `Page${seq}`;
      const all: string[] = [];
      for (let index = 0; index < 7; index++) all.push(await tag(`P${index}`, { city, score: 5 }));

      const seen: string[] = [];
      let cursor: number | undefined;
      let pages = 0;
      do {
        const page = await ProspectingRepository.listLeads(db, { city, limit: 3, cursor }, now);
        seen.push(...page.leads.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor !== undefined);

      equal(pages, 3);
      deepEqual(seen.sort(), all.sort());
    });

    it('queueBest queues the 20 best available leads of the filter', async () => {
      const zone = `Zona Q${seq}`;
      const made: { id: string; score: number | null }[] = [];
      for (let index = 0; index < 25; index++) {
        const score = index === 0 ? null : index % 11;
        made.push({ id: await tag(`Q${index}`, { zone, score }), score });
      }
      const queued = await tag('QQ', { zone, status: ProspectStatus.Queued });
      const manual = await tag('QM', { zone, status: ProspectStatus.Manual });
      const other = await tag('QO', { zone: 'Outra Zona', score: 10 });

      const result = await ProspectingRepository.queueBest(db, { zone }, now);

      equal(result.queued, 20);

      const rows = await db.prospect_leads.findMany({
        select: { id: true, status: true, score: true, queued_at: true },
        where: { zone }
      });
      const nowQueued = rows.records.filter((item) => item.status === ProspectStatus.Queued && item.id !== queued);

      equal(nowQueued.length, 20);
      equal(new Set(nowQueued.map((item) => item.queued_at)).size, 1);
      equal(nowQueued[0]!.queued_at, now.toISOString());
      ok(!nowQueued.some((item) => item.score === null));

      const left = rows.records.filter((item) => item.status === ProspectStatus.Available);
      equal(left.length, 5);
      const minQueued = Math.min(...nowQueued.map((item) => item.score!));
      ok(left.every((item) => item.score === null || item.score <= minQueued));
      equal((await findLead(manual)).status, ProspectStatus.Manual);
      equal((await findLead(other)).status, ProspectStatus.Available);
    });

    it('queueBest puts unscored leads last and returns fewer when few exist', async () => {
      const zone = `Zona R${seq}`;
      await tag('R1', { zone, score: null });
      const scored = await tag('R2', { zone, score: 3 });
      await tag('R3', { zone, score: null });
      await tag('R4', { zone, score: 1 });
      await tag('R5', { zone, score: 7 });

      deepEqual(await ProspectingRepository.queueBest(db, { zone }, now), { queued: 5 });
      equal((await findLead(scored)).status, ProspectStatus.Queued);
      deepEqual(await ProspectingRepository.queueBest(db, { zone }, now), { queued: 0 });
    });

    it('queueBest skips a lead that stopped being available', async () => {
      const zone = `Zona S${seq}`;
      const first = await tag('S1', { zone, score: 9 });
      const second = await tag('S2', { zone, score: 8 });

      // The first lead is set to manual after it was picked and before its conditional update.
      const original = db.transaction.bind(db);
      let raced = false;

      (db as { transaction: unknown }).transaction = (run: (tx: typeof db) => Promise<unknown>) =>
        original((tx: typeof db) =>
          run(
            new Proxy(tx, {
              get: (target, key) =>
                key === 'prospect_leads'
                  ? new Proxy(target.prospect_leads, {
                      get: (table, method) =>
                        method === 'updateMany'
                          ? async (args: unknown) => {
                              if (!raced) {
                                raced = true;
                                await setLead(first, { status: ProspectStatus.Manual });
                              }
                              return table.updateMany(args as never);
                            }
                          : (Reflect.get(table, method) as unknown)
                    })
                  : (Reflect.get(target, key) as unknown)
            })
          )
        );

      try {
        deepEqual(await ProspectingRepository.queueBest(db, { zone }, now), { queued: 1 });
      } finally {
        (db as { transaction: unknown }).transaction = original;
      }
      equal((await findLead(first)).status, ProspectStatus.Manual);
      equal((await findLead(second)).status, ProspectStatus.Queued);
    });

    it('overview counts inside a place and lists distinct sorted places and categories', async () => {
      const city = `Ov${seq}`;
      await tag('O1', { city, zone: 'Z1', neighborhood: 'B', category: 'Zeta', situation: ProspectSituation.None });
      await tag('O2', {
        city,
        zone: 'Z1',
        neighborhood: 'B',
        category: 'Alfa',
        situation: null,
        status: ProspectStatus.Manual
      });
      await tag('O3', { city: `${city}x`, zone: 'Z2', category: 'Alfa', situation: ProspectSituation.None });

      const overview = await ProspectingRepository.overview(db, { city });

      equal(overview.situations.none, 1);
      equal(overview.situations.unknown, 1);
      equal(overview.situations.whatsapp, 0);
      equal(overview.situations.onlineOrder, 0);
      equal(overview.statuses.available, 1);
      equal(overview.statuses.manual, 1);

      const mine = overview.places.filter((item) => item.city.startsWith(city));
      deepEqual(mine, [
        { city, zone: 'Z1', neighborhood: 'B' },
        { city: `${city}x`, zone: 'Z2', neighborhood: null }
      ]);
      equal(overview.categories.filter((item) => item === 'Alfa').length, 1);
      ok(overview.categories.indexOf('Alfa') < overview.categories.indexOf('Zeta'));
    });
  });
});
