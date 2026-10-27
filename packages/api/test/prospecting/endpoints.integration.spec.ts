import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { HttpBadRequestError, HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { bulkUpdateProspectsHandler } from '../../src/prospecting/endpoints/bulk-update-prospects';
import { connectProspectingWhatsAppHandler } from '../../src/prospecting/endpoints/connect-prospecting-whatsapp';
import { disconnectProspectingWhatsAppHandler } from '../../src/prospecting/endpoints/disconnect-prospecting-whatsapp';
import { getProspectingHandler } from '../../src/prospecting/endpoints/get-prospecting';
import { getProspectingWhatsAppHandler } from '../../src/prospecting/endpoints/get-prospecting-whatsapp';
import { getProspectsOverviewHandler } from '../../src/prospecting/endpoints/get-prospects-overview';
import { importProspectsHandler } from '../../src/prospecting/endpoints/import-prospects';
import { listProspectsHandler } from '../../src/prospecting/endpoints/list-prospects';
import { queueBestProspectsHandler } from '../../src/prospecting/endpoints/queue-best-prospects';
import { updateProspectHandler } from '../../src/prospecting/endpoints/update-prospect';
import { updateProspectingHandler } from '../../src/prospecting/endpoints/update-prospecting';
import { ProspectSituation, ProspectStatus } from '../../src/prospecting/types';

describe('prospecting admin endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const identity = { userId: 'user_admin' };

  const env = {
    EVOLUTION_API_URL: 'http://evo',
    EVOLUTION_API_KEY: 'global-key',
    WEBHOOK_BASE_URL: 'http://api.test/base'
  };

  let seq = 0;

  const lead = () => {
    seq++;

    return {
      name: `Pizzaria ${seq}`,
      phone: `119${String(70000000 + seq)}`,
      messages: ['Oi, tudo bem?', 'Oi! Aqui é o Well.']
    };
  };

  const importLeads = (count: number) =>
    importProspectsHandler({ identity, body: { leads: Array.from({ length: count }, lead) } } as never, { db });

  // The sender and the leads are global: start and leave them empty for the other specs.
  const reset = async () => {
    await db.prospect_leads.deleteMany({ where: {} });
    await db.prospecting_sender.deleteMany({ where: {} });
  };

  beforeEach(reset);

  afterEach(async () => {
    mock.restoreAll();
    await reset();
  });

  it('reports the sender, counts, the cap and the reply rate', async () => {
    const { body: imported } = await importLeads(3);

    equal(imported.added, 3);

    const {
      body: { leads }
    } = await listProspectsHandler({ identity, query: {} } as never, { db });

    await db.prospect_leads.updateOne({
      data: { status: ProspectStatus.Sent, sent_at: new Date().toISOString() },
      where: { id: leads[0]!.id }
    });
    await db.prospect_leads.updateOne({
      data: { status: ProspectStatus.Replied, sent_at: new Date().toISOString() },
      where: { id: leads[1]!.id }
    });

    const { body } = await getProspectingHandler({ identity } as never, { db });

    equal(body.replyRate, 0.5);
    equal(body.capToday, 20);
    equal(body.sentToday, 2);
    equal(body.counts.available, 1);
    equal(body.counts.queued, 0);
    equal(body.counts.sent, 1);
    equal(body.counts.replied, 1);
    equal(body.sender.connected, false);
    equal(body.sender.paused, false);
    equal(body.sender.maxDaily, 50);
    deepEqual(body.sender.window, { startHour: 10, endHour: 18, weekdays: [1, 2, 3, 4, 5, 6] });
  });

  it('has no reply rate without sent leads', async () => {
    const { body } = await getProspectingHandler({ identity } as never, { db });

    equal(body.replyRate, null);
  });

  it('updates the sender and refuses empty or bad patches', async () => {
    const update = (patch: object) => updateProspectingHandler({ identity, body: patch } as never, { db });

    await rejects(
      update({}),
      (error) => error instanceof HttpBadRequestError && error.message === 'Nothing to update.'
    );

    const { body } = await update({
      paused: false,
      maxDaily: 30,
      window: { startHour: 9, endHour: 17, weekdays: [1, 2, 3] }
    });

    equal(body.sender.paused, false);
    equal(body.sender.maxDaily, 30);
    deepEqual(body.sender.window, { startHour: 9, endHour: 17, weekdays: [1, 2, 3] });
    equal(body.capToday, 20);

    for (const window of [
      { startHour: 12, endHour: 12, weekdays: [1] },
      { startHour: 13, endHour: 12, weekdays: [1] },
      { startHour: 10, endHour: 18, weekdays: [] }
    ]) {
      await rejects(update({ window }), (error) => {
        ok(error instanceof HttpBadRequestError);
        equal((error.context as { field: string }).field, 'window');
        return true;
      });
    }
  });

  it('reads, connects and disconnects the WhatsApp instance', async () => {
    mock.method(globalThis, 'fetch', (url: string) => {
      const path = url.replace('http://evo', '');
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

      if (path.startsWith('/instance/create')) {
        return json({});
      }

      if (path.startsWith('/instance/connect')) {
        return json({ base64: 'data:image/png;base64,QR', pairingCode: 'ABCD' });
      }

      if (path.startsWith('/instance/connectionState')) {
        return json({ instance: { state: 'close' } });
      }

      return json({});
    });

    for (const key of Object.keys(env)) {
      process.env[key] = env[key as keyof typeof env];
    }

    const idle = await getProspectingWhatsAppHandler({ identity } as never, { db, ...env });

    equal(idle.body.state, 'not_created');

    const connected = await connectProspectingWhatsAppHandler({ identity } as never, { db, ...env });

    equal(connected.body.qrBase64, 'data:image/png;base64,QR');
    equal(connected.body.pairingCode, 'ABCD');

    const after = await disconnectProspectingWhatsAppHandler({ identity } as never, { db, ...env });

    ok(after.body.state);
  });

  it('imports leads and rejects a malformed file', async () => {
    const { status, body } = await importLeads(2);

    equal(status, 200);
    equal(body.added, 2);

    await rejects(importProspectsHandler({ identity, body: { nope: [] } } as never, { db }), (error) => {
      ok(error instanceof HttpBadRequestError);
      equal((error.context as { field: string }).field, 'file');
      return true;
    });
  });

  it('lists leads with a status filter, search and cursor', async () => {
    await importLeads(3);

    const list = (query: object) => listProspectsHandler({ identity, query } as never, { db });

    const all = await list({});

    equal(all.body.leads.length, 3);
    equal(all.body.nextCursor, null);
    equal(all.body.total, 3);

    const none = await list({ status: ProspectStatus.Sent });

    equal(none.body.leads.length, 0);
    equal(none.body.total, 0);

    const search = await list({ q: all.body.leads[1]!.name });

    equal(search.body.leads.length, 1);

    const next = await list({ cursor: all.body.leads[0]!.position });

    equal(next.body.leads.length, 2);
  });

  it('updates a lead note and status, 409 on a bad change and 404 on an unknown id', async () => {
    await importLeads(1);

    const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });
    const id = page.leads[0]!.id;

    const update = (leadId: string, body: object) =>
      updateProspectHandler({ identity, parameters: { id: leadId }, body } as never, { db });

    const { body } = await update(id, { note: 'ligar amanhã', status: ProspectStatus.Canceled });

    equal(body.note, 'ligar amanhã');
    equal(body.status, ProspectStatus.Canceled);

    await rejects(update(id, { status: ProspectStatus.Replied }), (error) => error instanceof HttpConflictError);
    await rejects(update(randomUUID(), { note: 'x' }), (error) => error instanceof HttpNotFoundError);
  });

  it('applies a status to many leads and counts the skipped', async () => {
    await importLeads(2);

    const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });
    const ids = page.leads.map(({ id }) => id);

    await db.prospect_leads.updateOne({ data: { status: ProspectStatus.Sent }, where: { id: ids[1]! } });

    const { body } = await bulkUpdateProspectsHandler(
      { identity, body: { ids, status: ProspectStatus.Canceled } } as never,
      { db }
    );

    deepEqual(body, { updated: 1, skipped: 1 });
  });

  describe('manual prospecting', () => {
    const tag = async (id: string, data: Record<string, unknown>) =>
      db.prospect_leads.updateOne({ data, where: { id } });

    const names = (leads: { name: string }[]) => leads.map((item) => item.name);

    it('filters, sorts and ignores empty params', async () => {
      await importLeads(3);

      const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });
      const [a, b, c] = page.leads;

      await tag(a!.id, { city: 'Sampa', situation: ProspectSituation.Competitor, score: 2 });
      await tag(b!.id, { city: 'Sampa', situation: ProspectSituation.Competitor, score: 9 });
      await tag(c!.id, { city: 'Rio', situation: ProspectSituation.None, score: 5 });

      const list = (query: object) => listProspectsHandler({ identity, query } as never, { db });

      const sorted = await list({ situation: 'competitor', sort: 'score' });

      deepEqual(names(sorted.body.leads), [b!.name, a!.name]);

      const empty = await list({ city: '', zone: '', q: '', category: '', neighborhood: '' });

      equal(empty.body.leads.length, 3);
    });

    it('moves queued leads back to available in bulk', async () => {
      await importLeads(2);

      const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });
      const ids = page.leads.map(({ id }) => id);
      const bulk = (status: ProspectStatus) =>
        bulkUpdateProspectsHandler({ identity, body: { ids, status } } as never, { db });

      await bulk(ProspectStatus.Queued);

      const { body } = await bulk(ProspectStatus.Available);

      deepEqual(body, { updated: 2, skipped: 0 });
      equal((await getProspectingHandler({ identity } as never, { db })).body.counts.available, 2);
    });

    it('queues the best available leads of the filter', async () => {
      await importLeads(3);

      const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });

      await tag(page.leads[0]!.id, { city: 'Sampa' });
      await tag(page.leads[1]!.id, { city: 'Sampa', status: ProspectStatus.Manual });
      await tag(page.leads[2]!.id, { city: 'Rio' });

      const { body } = await queueBestProspectsHandler({ identity, body: { city: 'Sampa', zone: '' } } as never, {
        db
      });

      deepEqual(body, { queued: 1 });

      const { body: after } = await getProspectingHandler({ identity } as never, { db });

      equal(after.counts.queued, 1);
      equal(after.counts.manual, 1);
      equal(after.counts.available, 1);
    });

    it('reports counts and places in the overview', async () => {
      await importLeads(2);

      const { body: page } = await listProspectsHandler({ identity, query: {} } as never, { db });

      await tag(page.leads[0]!.id, { city: 'Sampa', zone: 'Norte', situation: ProspectSituation.WhatsApp });
      await tag(page.leads[1]!.id, { city: 'Rio' });

      const { body } = await getProspectsOverviewHandler({ identity, query: { city: 'Sampa', zone: '' } } as never, {
        db
      });

      equal(body.situations.whatsapp, 1);
      equal(body.statuses.available, 1);
      ok(body.places.some((place) => place.city === 'Rio'));
      ok(body.places.some((place) => place.city === 'Sampa' && place.zone === 'Norte'));
    });
  });
});
