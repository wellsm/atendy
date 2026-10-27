import type { Object } from '@ez4/schema';
import type { DbClient } from '../db';
import type { ImportRowError, parseImport } from './import';
import type { ProspectLeadSchema } from './schemas/lead';
import type { ProspectingSenderSchema } from './schemas/sender';
import type { ProspectSystem, SendWindow } from './types';

import { randomBytes, randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { ACK_RANK, canSetStatus, STUCK_SENDING_MS } from './status';
import { DEFAULT_MAX_DAILY, DEFAULT_WINDOW, ProspectPauseReason, ProspectSituation, ProspectStatus } from './types';
import { localToday } from '../payments/cycle';
import { phoneVariants } from '../storefront/web-order';

const SENDER_ID = 'default';

const MAX_STORED_ERRORS = 100;

const LOOKUP_CHUNK = 500;

const DAY_MS = 86_400_000;

const OFFSET_MS = 3 * 60 * 60_000;

/**
 * Statuses of a lead we actually messaged (manual ones are excluded from every rate and cap).
 */
const SENT_STATUSES = [ProspectStatus.Sent, ProspectStatus.Delivered, ProspectStatus.Read, ProspectStatus.Replied];

const ALL_STATUSES = [
  ...SENT_STATUSES,
  ProspectStatus.Available,
  ProspectStatus.Queued,
  ProspectStatus.Sending,
  ProspectStatus.Failed,
  ProspectStatus.Canceled,
  ProspectStatus.Manual
];

/**
 * Both forms of a Brazilian mobile number. `phoneVariants` only drops the 9 of a 13-digit number, but WhatsApp may
 * report the old 12-digit form of a number stored with the 9 (and the other way round).
 */
const lookupVariants = (phone: string) =>
  phone.length === 12 && /[6-9]/.test(phone[4]!)
    ? [phone, `${phone.slice(0, 4)}9${phone.slice(4)}`]
    : phoneVariants(phone);

const QUEUE_BEST_COUNT = 20;

const SITUATIONS = [
  ProspectSituation.WhatsApp,
  ProspectSituation.OnlineOrder,
  ProspectSituation.Marketplace,
  ProspectSituation.Competitor,
  ProspectSituation.None,
  'unknown'
] as const;

const SORT_COLUMNS = {
  score: { name: 'score', direction: Order.Desc, nullable: true },
  reviews: { name: 'reviews', direction: Order.Desc, nullable: true },
  name: { name: 'name', direction: Order.Asc, nullable: false }
} as const;

export class ProspectStatusError extends Error {}

export class ProspectNotFoundError extends Error {}

const SENDER_SELECT = {
  id: true,
  whatsapp_instance: true,
  whatsapp_instance_token: true,
  webhook_secret: true,
  connected: true,
  paused: true,
  pause_reason: true,
  max_daily: true,
  window_start_hour: true,
  window_end_hour: true,
  weekdays: true,
  next_send_at: true,
  consecutive_failures: true,
  first_sent_at: true,
  brake_since: true
} as const;

const LEAD_SELECT = {
  id: true,
  import_id: true,
  position: true,
  phone: true,
  name: true,
  info: true,
  messages: true,
  sent_message: true,
  provider_message_id: true,
  status: true,
  failure_reason: true,
  sent_at: true,
  delivered_at: true,
  read_at: true,
  replied_at: true,
  note: true,
  category: true,
  neighborhood: true,
  zone: true,
  city: true,
  postal_code: true,
  situation: true,
  systems: true,
  rating: true,
  reviews: true,
  score: true,
  site: true,
  mobile: true,
  queued_at: true,
  updated_at: true
} as const;

type LeadDbRow = ProspectLeadSchema;

const toSender = (row: ProspectingSenderSchema): ProspectingRepository.Sender => ({
  id: 'default',
  instance: row.whatsapp_instance ?? null,
  token: row.whatsapp_instance_token ?? null,
  webhookSecret: row.webhook_secret,
  connected: row.connected,
  paused: row.paused,
  pauseReason: row.pause_reason ?? null,
  maxDaily: row.max_daily,
  window: { startHour: row.window_start_hour, endHour: row.window_end_hour, weekdays: row.weekdays },
  nextSendAt: row.next_send_at ?? null,
  consecutiveFailures: row.consecutive_failures,
  firstSentAt: row.first_sent_at ?? null,
  brakeSince: row.brake_since ?? null
});

const toLead = (row: LeadDbRow, now: Date): ProspectingRepository.LeadRow => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  info: row.info,
  messages: row.messages,
  sentMessage: row.sent_message ?? null,
  status: row.status,
  stuck: isStuck(row, now),
  failureReason: row.failure_reason ?? null,
  sentAt: row.sent_at ?? null,
  deliveredAt: row.delivered_at ?? null,
  readAt: row.read_at ?? null,
  repliedAt: row.replied_at ?? null,
  note: row.note ?? null,
  position: row.position,
  category: row.category ?? null,
  neighborhood: row.neighborhood ?? null,
  zone: row.zone ?? null,
  city: row.city ?? null,
  postalCode: row.postal_code ?? null,
  situation: row.situation ?? null,
  systems: row.systems ?? null,
  rating: row.rating ?? null,
  reviews: row.reviews ?? null,
  score: row.score ?? null,
  site: row.site ?? null,
  mobile: row.mobile ?? null,
  queuedAt: row.queued_at ?? null
});

const isStuck = (row: Pick<LeadDbRow, 'status' | 'updated_at'>, now: Date) =>
  row.status === ProspectStatus.Sending && now.getTime() - new Date(row.updated_at).getTime() > STUCK_SENDING_MS;

/**
 * Phone prefixes a search may mean: only for a query written like a phone (digits, spaces, `+()-.`), so a name with a
 * number in it never matches by phone. Stored phones carry 55, so the digits are also tried with 55 in front (always:
 * 55 is a DDD too).
 */
const phonePrefixes = (search: string) => {
  const digits = search.replace(/\D/g, '');

  if (!digits || !/^[\d\s()+.-]+$/.test(search)) {
    return [];
  }

  return [digits, `55${digits}`];
};

/**
 * Start of Brazil's calendar day of `now`, as an ISO instant.
 */
const dayStart = (now: Date) => new Date(Date.parse(`${localToday(now)}T00:00:00.000Z`) + OFFSET_MS);

export namespace ProspectingRepository {
  export type Sender = {
    id: 'default';
    instance: string | null;
    token: string | null;
    webhookSecret: string;
    connected: boolean;
    paused: boolean;
    pauseReason: ProspectPauseReason | null;
    maxDaily: number;
    window: SendWindow;
    nextSendAt: string | null;
    consecutiveFailures: number;
    firstSentAt: string | null;
    brakeSince: string | null;
  };

  export type SenderPatch = { paused?: boolean; maxDaily?: number; window?: SendWindow };

  export type ImportResult = {
    importId: string;
    total: number;
    added: number;
    skippedDuplicate: number;
    skippedInvalid: number;
    errors: ImportRowError[];
  };

  export type LeadSort = 'score' | 'reviews' | 'name';

  export type LeadFilters = {
    status?: ProspectStatus;
    q?: string;
    city?: string;
    zone?: string;
    neighborhood?: string;
    category?: string;
    situation?: ProspectSituation;
    mobile?: boolean;
  };

  /**
   * Counts use explicit keys: the gateway drops a `Record<enum, number>` from the response body.
   */
  export type Overview = {
    situations: {
      whatsapp: number;
      onlineOrder: number;
      marketplace: number;
      competitor: number;
      none: number;
      unknown: number;
    };
    statuses: {
      available: number;
      queued: number;
      sending: number;
      sent: number;
      delivered: number;
      read: number;
      replied: number;
      failed: number;
      canceled: number;
      manual: number;
    };
    places: { city: string; zone: string | null; neighborhood: string | null }[];
    categories: string[];
  };

  export type LeadRow = {
    id: string;
    name: string;
    phone: string;
    /**
     * `Object.Any`, like the column: the gateway drops a `Record<string, ...>` from the response body.
     */
    info: Object.Any;
    messages: string[];
    sentMessage: string | null;
    status: ProspectStatus;
    stuck: boolean;
    failureReason: string | null;
    sentAt: string | null;
    deliveredAt: string | null;
    readAt: string | null;
    repliedAt: string | null;
    note: string | null;
    position: number;
    category: string | null;
    neighborhood: string | null;
    zone: string | null;
    city: string | null;
    postalCode: string | null;
    situation: ProspectSituation | null;
    systems: ProspectSystem[] | null;
    rating: number | null;
    reviews: number | null;
    score: number | null;
    site: string | null;
    mobile: boolean | null;
    queuedAt: string | null;
  };

  /**
   * The single sender row, created unpaused with a random webhook secret when missing.
   */
  export const getSender = async (db: DbClient): Promise<Sender> => {
    const existing = await db.prospecting_sender.findOne({ select: SENDER_SELECT, where: { id: SENDER_ID } });

    if (existing) {
      return toSender(existing);
    }

    try {
      await db.prospecting_sender.insertOne({
        data: {
          id: SENDER_ID,
          webhook_secret: randomBytes(32).toString('hex'),
          connected: false,
          paused: false,
          max_daily: DEFAULT_MAX_DAILY,
          window_start_hour: DEFAULT_WINDOW.startHour,
          window_end_hour: DEFAULT_WINDOW.endHour,
          weekdays: DEFAULT_WINDOW.weekdays,
          consecutive_failures: 0
        }
      });
    } catch {
      // A parallel call created it first.
    }

    const created = await db.prospecting_sender.findOne({ select: SENDER_SELECT, where: { id: SENDER_ID } });

    if (!created) {
      throw new Error('Could not create the prospecting sender');
    }

    return toSender(created);
  };

  /**
   * Admin changes. Resuming clears the pause reason and failures; only a resume after a `low_replies` pause starts a
   * new brake window. Pausing by hand keeps an automatic reason when one is already set.
   */
  export const updateSender = async (db: DbClient, patch: SenderPatch, now: Date): Promise<Sender> => {
    const current = await getSender(db);

    const resume = patch.paused === false && current.paused;
    const pause = patch.paused === true && !current.paused;
    const newBrake = resume && current.pauseReason === ProspectPauseReason.LowReplies;

    await db.prospecting_sender.updateOne({
      data: {
        ...(patch.paused !== undefined && { paused: patch.paused }),
        ...(patch.maxDaily !== undefined && { max_daily: patch.maxDaily }),
        ...(patch.window && {
          window_start_hour: patch.window.startHour,
          window_end_hour: patch.window.endHour,
          weekdays: patch.window.weekdays
        }),
        ...(resume && { pause_reason: null, consecutive_failures: 0 }),
        ...(newBrake && { brake_since: now.toISOString() }),
        ...(pause && { pause_reason: ProspectPauseReason.Manual })
      },
      where: { id: SENDER_ID }
    });

    return getSender(db);
  };

  export const setSenderState = async (
    db: DbClient,
    data: Partial<
      Pick<
        Sender,
        | 'instance'
        | 'token'
        | 'connected'
        | 'paused'
        | 'pauseReason'
        | 'nextSendAt'
        | 'consecutiveFailures'
        | 'firstSentAt'
      >
    >
  ) => {
    await getSender(db);

    await db.prospecting_sender.updateOne({
      data: {
        ...(data.instance !== undefined && { whatsapp_instance: data.instance }),
        ...(data.token !== undefined && { whatsapp_instance_token: data.token }),
        ...(data.connected !== undefined && { connected: data.connected }),
        ...(data.paused !== undefined && { paused: data.paused }),
        ...(data.pauseReason !== undefined && { pause_reason: data.pauseReason }),
        ...(data.nextSendAt !== undefined && { next_send_at: data.nextSendAt }),
        ...(data.consecutiveFailures !== undefined && { consecutive_failures: data.consecutiveFailures }),
        ...(data.firstSentAt !== undefined && { first_sent_at: data.firstSentAt })
      },
      where: { id: SENDER_ID }
    });
  };

  /**
   * Stores the valid rows after the current last position. A phone already stored in any `phoneVariants` form counts
   * as a duplicate, like a repeat inside the file.
   */
  export const importLeads = async (
    db: DbClient,
    parsed: ReturnType<typeof parseImport>,
    now: Date
  ): Promise<ImportResult> => {
    const errors = parsed.errors.slice(0, MAX_STORED_ERRORS);
    const importId = randomUUID();
    const variants = parsed.rows.flatMap((row) => lookupVariants(row.phone));

    return db.transaction(async (tx) => {
      // Serializes imports so positions never repeat and a phone in both of its forms is stored once.
      await tx.prospecting_sender.findOne({ select: SENDER_SELECT, where: { id: SENDER_ID }, lock: true });

      const taken = new Set<string>();

      for (let from = 0; from < variants.length; from += LOOKUP_CHUNK) {
        const { records: found } = await tx.prospect_leads.findMany({
          select: { phone: true },
          where: { phone: { isIn: variants.slice(from, from + LOOKUP_CHUNK) } }
        });

        found.forEach(({ phone }) => taken.add(phone));
      }

      const fresh = parsed.rows.filter((row) => !lookupVariants(row.phone).some((variant) => taken.has(variant)));
      const skippedDuplicate = parsed.duplicates + parsed.rows.length - fresh.length;

      const result: ImportResult = {
        importId,
        total: parsed.rows.length + parsed.errors.length + parsed.duplicates,
        added: fresh.length,
        skippedDuplicate,
        skippedInvalid: parsed.errors.length,
        errors
      };

      const {
        records: [last]
      } = await tx.prospect_leads.findMany({
        select: { position: true },
        order: { position: Order.Desc },
        take: 1
      });

      const start = last?.position ?? 0;

      await tx.prospect_imports.insertOne({
        data: {
          id: importId,
          created_at: now.toISOString(),
          total: result.total,
          added: result.added,
          skipped_duplicate: skippedDuplicate,
          skipped_invalid: result.skippedInvalid,
          errors
        }
      });

      if (fresh.length) {
        await tx.prospect_leads.insertMany({
          data: fresh.map((row, index) => ({
            id: randomUUID(),
            import_id: importId,
            position: start + index + 1,
            phone: row.phone,
            name: row.name,
            info: row.info,
            messages: row.messages,
            category: row.details.category,
            neighborhood: row.details.neighborhood,
            zone: row.details.zone,
            city: row.details.city,
            postal_code: row.details.postalCode,
            situation: row.details.situation,
            systems: row.details.systems,
            rating: row.details.rating,
            reviews: row.details.reviews,
            score: row.details.score,
            site: row.details.site,
            mobile: row.details.mobile,
            status: ProspectStatus.Available,
            updated_at: now.toISOString()
          }))
        });
      }

      return result;
    });
  };

  /**
   * Queue order: `queued_at` asc, then `score` desc with unscored leads last, then `position`. Only leads the admin
   * queued (`queued_at` set) are eligible: legacy `queued` rows without it are never claimed.
   */
  const nextQueued = async (tx: DbClient) => {
    const {
      records: [oldest]
    } = await tx.prospect_leads.findMany({
      select: { queued_at: true },
      where: { status: ProspectStatus.Queued, queued_at: { isNull: false } },
      order: { queued_at: Order.Asc },
      take: 1
    });

    if (!oldest) {
      return undefined;
    }

    const group = { status: ProspectStatus.Queued, queued_at: oldest.queued_at! };

    const {
      records: [scored]
    } = await tx.prospect_leads.findMany({
      select: LEAD_SELECT,
      where: { ...group, score: { isNull: false } },
      order: { score: Order.Desc, position: Order.Asc },
      take: 1,
      lock: true
    });

    if (scored) {
      return scored;
    }

    const {
      records: [unscored]
    } = await tx.prospect_leads.findMany({
      select: LEAD_SELECT,
      where: group,
      order: { position: Order.Asc },
      take: 1,
      lock: true
    });

    return unscored;
  };

  /**
   * Takes the next queued lead and marks it `sending`. The sender row is locked first, so parallel calls
   * queue up and never pick the same lead. The locked row is re-checked (paused, disconnected, `next_send_at`) and
   * `next_send_at = now + gapMs` is written in the same transaction, so overlapping runs never send back to back.
   */
  export const claimNext = async (db: DbClient, now: Date, gapMs: number) => {
    await getSender(db);

    return db.transaction(async (tx) => {
      const sender = await tx.prospecting_sender.findOne({
        select: SENDER_SELECT,
        where: { id: SENDER_ID },
        lock: true
      });

      if (
        !sender ||
        sender.paused ||
        !sender.connected ||
        (sender.next_send_at && now.getTime() < Date.parse(sender.next_send_at))
      ) {
        return undefined;
      }

      const lead = await nextQueued(tx);

      if (!lead) {
        return undefined;
      }

      // The admin can set the lead to manual without the sender lock: only a still queued lead is claimed.
      const { length } = await tx.prospect_leads.updateMany({
        select: { id: true },
        data: { status: ProspectStatus.Sending, updated_at: now.toISOString() },
        where: { id: lead.id, status: ProspectStatus.Queued }
      });

      if (!length) {
        return undefined;
      }

      await tx.prospecting_sender.updateOne({
        data: { next_send_at: new Date(now.getTime() + gapMs).toISOString() },
        where: { id: SENDER_ID }
      });

      return { id: lead.id, phone: lead.phone, messages: lead.messages };
    });
  };

  export const markSent = async (
    db: DbClient,
    id: string,
    sent: { text: string; providerMessageId: string; at: Date }
  ) => {
    await db.prospect_leads.updateOne({
      data: {
        status: ProspectStatus.Sent,
        sent_message: sent.text,
        provider_message_id: sent.providerMessageId,
        sent_at: sent.at.toISOString(),
        failure_reason: null,
        updated_at: sent.at.toISOString()
      },
      where: { id }
    });
  };

  export const markFailed = async (db: DbClient, id: string, reason: string) => {
    await db.prospect_leads.updateOne({
      data: { status: ProspectStatus.Failed, failure_reason: reason, updated_at: new Date().toISOString() },
      where: { id }
    });
  };

  /**
   * Messages sent in Brazil's calendar day of `now` (manual leads never count).
   */
  export const sentOn = async (db: DbClient, now: Date) => {
    const start = dayStart(now);

    return db.prospect_leads.count({
      where: {
        status: { isIn: SENT_STATUSES },
        sent_at: { gte: start.toISOString(), lt: new Date(start.getTime() + DAY_MS).toISOString() }
      }
    });
  };

  /**
   * Leads sent after `since` and at least 24 h ago, with how many replied: the sample of the low-reply brake.
   */
  export const replySample = async (db: DbClient, since: string | null, now: Date) => {
    const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
    const sentAt = { lt: cutoff, ...(since && { gt: since }) };

    const [sent, replied] = await Promise.all([
      db.prospect_leads.count({ where: { status: { isIn: SENT_STATUSES }, sent_at: sentAt } }),
      db.prospect_leads.count({ where: { status: ProspectStatus.Replied, sent_at: sentAt } })
    ]);

    return { sent, replied };
  };

  /**
   * Leads matching `where`, ordered by `sort` with NULLs last (the database cannot), then by `position`: the non-null
   * group is read first and the NULL group fills the rest of the page.
   */
  const findSorted = async (
    db: DbClient,
    where: Record<string, unknown>,
    sort: ProspectingRepository.LeadSort,
    range: { skip: number; take: number }
  ) => {
    const column = SORT_COLUMNS[sort];

    if (!column.nullable) {
      const { records } = await db.prospect_leads.findMany({
        select: LEAD_SELECT,
        where,
        order: { [column.name]: column.direction, position: Order.Asc },
        ...range
      });

      return records;
    }

    const filled = { ...where, [column.name]: { isNull: false } };
    const total = await db.prospect_leads.count({ where: filled });

    const { records: head } =
      range.skip < total
        ? await db.prospect_leads.findMany({
            select: LEAD_SELECT,
            where: filled,
            order: { [column.name]: column.direction, position: Order.Asc },
            ...range
          })
        : { records: [] };

    if (head.length === range.take) {
      return head;
    }

    const { records: tail } = await db.prospect_leads.findMany({
      select: LEAD_SELECT,
      where: { ...where, [column.name]: { isNull: true } },
      order: { position: Order.Asc },
      skip: Math.max(0, range.skip - total),
      take: range.take - head.length
    });

    return [...head, ...tail];
  };

  /**
   * Names of detected systems containing `search` (any case) among the leads that pass the other filters. A JSON
   * `contains` needs the exact element, so the matching names are found first and then matched exactly. Distinct
   * system names are few, so the result is never capped.
   */
  const systemNamesLike = async (db: DbClient, search: string, narrow: Record<string, unknown>) => {
    const { records } = await db.prospect_leads.findMany({
      select: { systems: true },
      where: { ...narrow, systems: { isNull: false } }
    });

    const needle = search.toLowerCase();
    const names = new Set<string>();

    for (const { systems } of records) {
      for (const system of systems ?? []) {
        if (system.name.toLowerCase().includes(needle)) {
          names.add(system.name);
        }
      }
    }

    return [...names];
  };

  const leadWhere = async (db: DbClient, filters: LeadFilters) => {
    const search = filters.q?.trim();

    const narrow = {
      ...(filters.status && { status: filters.status }),
      ...(filters.city && { city: filters.city }),
      ...(filters.zone && { zone: filters.zone }),
      ...(filters.neighborhood && { neighborhood: filters.neighborhood }),
      ...(filters.category && { category: filters.category }),
      ...(filters.situation && { situation: filters.situation }),
      ...(filters.mobile !== undefined && { mobile: filters.mobile })
    };

    const systemNames = search ? await systemNamesLike(db, search, narrow) : [];

    return {
      ...narrow,
      ...(search && {
        OR: [
          { name: { contains: search, insensitive: true } },
          { category: { contains: search, insensitive: true } },
          ...phonePrefixes(search).map((prefix) => ({ phone: { startsWith: prefix } })),
          ...systemNames.map((name) => ({ systems: { contains: [{ name }] } }))
        ]
      })
    };
  };

  /**
   * `cursor` is an offset into the sorted list.
   */
  export const listLeads = async (
    db: DbClient,
    query: LeadFilters & { sort?: LeadSort; cursor?: number; limit: number },
    now: Date
  ) => {
    const skip = query.cursor ?? 0;

    const where: Record<string, unknown> = await leadWhere(db, query);

    const [rows, total] = await Promise.all([
      findSorted(db, where, query.sort ?? 'score', { skip, take: query.limit + 1 }),
      db.prospect_leads.count({ where: { ...where } })
    ]);

    return {
      total,
      leads: rows.slice(0, query.limit).map((row) => toLead(row, now)),
      nextCursor: rows.length > query.limit ? skip + query.limit : null
    };
  };

  /**
   * Queues the best `QUEUE_BEST_COUNT` available leads of the filter (score desc, unscored last) with one shared
   * `queued_at`. Each row is claimed with `status = available`, so a lead changed meanwhile is skipped and not counted.
   */
  export const queueBest = async (db: DbClient, filters: Omit<LeadFilters, 'status'>, now: Date) => {
    const where = await leadWhere(db, { ...filters, status: ProspectStatus.Available });

    return db.transaction(async (tx) => {
      const picked = await findSorted(tx, where, 'score', { skip: 0, take: QUEUE_BEST_COUNT });

      let queued = 0;

      for (const { id } of picked) {
        const { length } = await tx.prospect_leads.updateMany({
          select: { id: true },
          data: { ...statusData(ProspectStatus.Queued, now), updated_at: now.toISOString() },
          where: { id, status: ProspectStatus.Available }
        });

        queued += length;
      }

      return { queued };
    });
  };

  /**
   * Counts by situation and status inside a place, plus the distinct places and categories of all leads for the
   * filter selects (pt-BR order).
   */
  export const overview = async (
    db: DbClient,
    place: { city?: string; zone?: string; neighborhood?: string }
  ): Promise<Overview> => {
    const where = {
      ...(place.city && { city: place.city }),
      ...(place.zone && { zone: place.zone }),
      ...(place.neighborhood && { neighborhood: place.neighborhood })
    };

    const [situationCounts, statusCounts, { records: located }] = await Promise.all([
      Promise.all(
        SITUATIONS.map(
          async (situation) =>
            [
              situation,
              await db.prospect_leads.count({
                where: { ...where, situation: situation === 'unknown' ? { isMissingOrNull: true } : situation }
              })
            ] as const
        )
      ),
      Promise.all(
        ALL_STATUSES.map(
          async (status) => [status, await db.prospect_leads.count({ where: { ...where, status } })] as const
        )
      ),
      db.prospect_leads.findMany({ select: { city: true, zone: true, neighborhood: true, category: true } })
    ]);

    const places = new Map<string, Overview['places'][number]>();

    for (const { city, zone, neighborhood } of located) {
      if (city) {
        places.set(JSON.stringify([city, zone, neighborhood]), {
          city,
          zone: zone ?? null,
          neighborhood: neighborhood ?? null
        });
      }
    }

    const collator = new Intl.Collator('pt-BR');
    const text = (value: string | null) => value ?? '';
    const situations = new Map<string, number>(situationCounts);

    return {
      situations: {
        whatsapp: situations.get(ProspectSituation.WhatsApp) ?? 0,
        onlineOrder: situations.get(ProspectSituation.OnlineOrder) ?? 0,
        marketplace: situations.get(ProspectSituation.Marketplace) ?? 0,
        competitor: situations.get(ProspectSituation.Competitor) ?? 0,
        none: situations.get(ProspectSituation.None) ?? 0,
        unknown: situations.get('unknown') ?? 0
      },
      statuses: Object.fromEntries(statusCounts) as Overview['statuses'],
      places: [...places.values()].sort(
        (a, b) =>
          collator.compare(a.city, b.city) ||
          collator.compare(text(a.zone), text(b.zone)) ||
          collator.compare(text(a.neighborhood), text(b.neighborhood))
      ),
      categories: [...new Set(located.flatMap(({ category }) => (category ? [category] : [])))].sort(collator.compare)
    };
  };

  export const updateLead = async (
    db: DbClient,
    id: string,
    patch: { note?: string | null; status?: ProspectStatus },
    now: Date
  ): Promise<LeadRow> =>
    db.transaction(async (tx) => {
      const lead = await tx.prospect_leads.findOne({ select: LEAD_SELECT, where: { id }, lock: true });

      if (!lead) {
        throw new ProspectNotFoundError('Lead not found');
      }

      if (patch.status !== undefined && patch.status !== lead.status) {
        if (!canSetStatus(lead.status, patch.status, isStuck(lead, now))) {
          throw new ProspectStatusError(`Cannot change a ${lead.status} lead to ${patch.status}`);
        }
      }

      const changed = patch.status !== undefined && patch.status !== lead.status;

      await tx.prospect_leads.updateOne({
        data: {
          ...(patch.note !== undefined && { note: patch.note }),
          ...(changed && statusData(patch.status!, now)),
          updated_at: now.toISOString()
        },
        where: { id }
      });

      const updated = await tx.prospect_leads.findOne({ select: LEAD_SELECT, where: { id } });

      return toLead(updated!, now);
    });

  /**
   * Columns that go with a manual status change.
   */
  const statusData = (status: ProspectStatus, now: Date) => ({
    status,
    ...(status === ProspectStatus.Queued && { failure_reason: null, queued_at: now.toISOString() }),
    ...(status === ProspectStatus.Available && { queued_at: null, failure_reason: null }),
    ...(status === ProspectStatus.Sent && { sent_at: now.toISOString() }),
    ...(status === ProspectStatus.Replied && { replied_at: now.toISOString() })
  });

  /**
   * Applies one status to many leads; those that cannot take it are skipped.
   */
  export const bulkSetStatus = async (db: DbClient, ids: string[], status: ProspectStatus, now: Date) => {
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const id of ids) {
        const lead = await tx.prospect_leads.findOne({ select: LEAD_SELECT, where: { id }, lock: true });

        if (!lead || !canSetStatus(lead.status, status, isStuck(lead, now))) {
          continue;
        }

        await tx.prospect_leads.updateOne({
          data: { ...statusData(status, now), updated_at: now.toISOString() },
          where: { id }
        });

        updated++;
      }
    });

    return { updated, skipped: ids.length - updated };
  };

  export const counts = async (db: DbClient) => {
    const entries = await Promise.all(
      ALL_STATUSES.map(async (status) => [status, await db.prospect_leads.count({ where: { status } })] as const)
    );

    return Object.fromEntries(entries) as Record<ProspectStatus, number>;
  };

  /**
   * A lead answered: only a lead we sent to (not manual, not queued) with the reply after the send.
   */
  export const markReplied = async (db: DbClient, phone: string, at: Date) =>
    db.transaction(async (tx) => {
      const {
        records: [lead]
      } = await tx.prospect_leads.findMany({
        select: LEAD_SELECT,
        where: {
          phone: { isIn: lookupVariants(phone) },
          status: { isIn: [ProspectStatus.Sent, ProspectStatus.Delivered, ProspectStatus.Read] }
        },
        take: 1,
        lock: true
      });

      if (!lead?.sent_at || new Date(lead.sent_at).getTime() >= at.getTime()) {
        return false;
      }

      await tx.prospect_leads.updateOne({
        data: { status: ProspectStatus.Replied, replied_at: at.toISOString(), updated_at: at.toISOString() },
        where: { id: lead.id }
      });

      return true;
    });

  /**
   * Delivery receipt by WhatsApp message id; statuses only move forward.
   */
  export const markAck = async (
    db: DbClient,
    providerMessageId: string,
    status: ProspectStatus.Delivered | ProspectStatus.Read,
    at: Date
  ) =>
    db.transaction(async (tx) => {
      const {
        records: [lead]
      } = await tx.prospect_leads.findMany({
        select: LEAD_SELECT,
        where: { provider_message_id: providerMessageId },
        take: 1,
        lock: true
      });

      const current = lead && ACK_RANK[lead.status];

      if (!lead || current === undefined || current >= ACK_RANK[status]!) {
        return false;
      }

      await tx.prospect_leads.updateOne({
        data: {
          status,
          ...(status === ProspectStatus.Delivered ? { delivered_at: at.toISOString() } : { read_at: at.toISOString() }),
          updated_at: at.toISOString()
        },
        where: { id: lead.id }
      });

      return true;
    });
}
