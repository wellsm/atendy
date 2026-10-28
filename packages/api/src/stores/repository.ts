import type { DbClient } from '../db';
import type { Coordinates, DeliveryBand } from './geo';
import type { HourRange } from './hours';
import type { DeliverySettings } from './settings';
import type { OrderCodeMode, PosSettings, StorePolicy } from './types';

import { randomBytes, randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { DeliveryMode, PaymentMethod, RouterType, WhatsAppProviderType } from './types';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-5.5';

export type CreateStoreInput = {
  name: string;
  slug: string;
  timezone?: string;
  llmModel: string;
  active?: boolean;
  clerkOrgId?: string;
  riskAcceptedAt?: string;
};

const PANEL_STORE_FIELDS = {
  id: true,
  name: true,
  slug: true,
  active: true,
  accepting_orders: true,
  timezone: true
} as const;

const HEALTH_WINDOW_MS = 24 * 60 * 60_000;

const RECENT_ERRORS = 5;

/**
 * Handoff reasons the inbound queue sets when the bot or WhatsApp failed.
 */
const ERROR_REASONS = ['send_failed', 'technical_error'];

export type StoreHealth = {
  lastMessageAt: string | null;
  errorCount24h: number;
  recentErrors: { conversationId: string; reason: string; at: string }[];
  activeProducts: number;
};

export namespace StoreRepository {
  /**
   * New stores start closed (`accepting_orders: false`), inactive unless `active` is given, and on the LLM router
   * until configured.
   */
  export const create = async (db: DbClient, input: CreateStoreInput) => {
    const now = new Date().toISOString();

    const id = randomUUID();
    const whatsappWebhookSecret = randomBytes(24).toString('hex');

    await db.stores.insertOne({
      data: {
        id,
        name: input.name,
        slug: input.slug,
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
        accepting_orders: false,
        active: input.active ?? false,
        clerk_org_id: input.clerkOrgId ?? null,
        risk_accepted_at: input.riskAcceptedAt ?? null,
        router: RouterType.Llm,
        llm_model: input.llmModel,
        whatsapp_provider: WhatsAppProviderType.Evolution,
        whatsapp_webhook_secret: whatsappWebhookSecret,
        delivery_mode: DeliveryMode.Flat,
        flat_fee_cents: 0,
        payment_methods: [PaymentMethod.Pix, PaymentMethod.Card, PaymentMethod.Cash],
        created_at: now,
        updated_at: now
      }
    });

    return { id, whatsappWebhookSecret };
  };

  export const list = async (db: DbClient) => {
    const { records } = await db.stores.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        accepting_orders: true,
        router: true
      },
      order: {
        created_at: Order.Asc
      }
    });

    return records;
  };

  export const findByOrgId = async (db: DbClient, orgId: string) => {
    const store = await db.stores.findOne({ select: PANEL_STORE_FIELDS, where: { clerk_org_id: orgId } });

    return store ?? undefined;
  };

  export const findBySlug = async (db: DbClient, slug: string) => {
    const store = await db.stores.findOne({ select: PANEL_STORE_FIELDS, where: { slug } });

    return store ?? undefined;
  };

  /**
   * Stores of these Clerk orgs (the panel's store switcher).
   */
  export const listByOrgIds = async (db: DbClient, orgIds: string[]) => {
    const { records } = await db.stores.findMany({
      select: { clerk_org_id: true, slug: true, name: true },
      where: { clerk_org_id: { isIn: orgIds } }
    });

    return records;
  };

  /**
   * Inactive stores first (waiting for the admin), newest first.
   */
  export const listForAdmin = async (db: DbClient) => {
    const { records } = await db.stores.findMany({
      select: { ...PANEL_STORE_FIELDS, created_at: true, router: true, llm_model: true },
      order: { created_at: Order.Desc }
    });

    return records.sort((a, b) => Number(a.active) - Number(b.active));
  };

  /**
   * Store as the admin sees it, with the technical settings; undefined when unknown.
   */
  export const getAdminStore = async (db: DbClient, storeId: string) => {
    return db.stores.findOne({
      select: {
        ...PANEL_STORE_FIELDS,
        created_at: true,
        router: true,
        llm_model: true,
        policy: true,
        order_price_cents: true,
        web_order_percent: true,
        order_code_mode: true
      },
      where: { id: storeId }
    });
  };

  /**
   * `null` goes back to the default price.
   */
  export const setOrderPrice = async (db: DbClient, storeId: string, cents: number | null) => {
    await db.stores.updateOne({
      data: { order_price_cents: cents, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  /**
   * `null` goes back to the default percent.
   */
  export const setWebOrderPercent = async (db: DbClient, storeId: string, percent: number | null) => {
    await db.stores.updateOne({
      data: { web_order_percent: percent, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  /**
   * Switching to sequential keeps counting from the last number given (or 1).
   */
  export const setOrderCodeMode = async (db: DbClient, storeId: string, mode: OrderCodeMode) => {
    await db.stores.updateOne({
      data: { order_code_mode: mode, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  export const setLlmModel = async (db: DbClient, storeId: string, model: string) => {
    await db.stores.updateOne({
      data: { llm_model: model, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  /**
   * Signals that a store is broken, from data that already exists. Errors are conversations whose last handoff was a
   * failed send or a bot failure, active within the last 24 h (conversation-level, so an approximation).
   */
  export const getHealth = async (db: DbClient, storeId: string, now = new Date()): Promise<StoreHealth> => {
    const since = new Date(now.getTime() - HEALTH_WINDOW_MS).toISOString();

    const [{ records: latest }, { records: errors }, activeProducts] = await Promise.all([
      db.conversations.findMany({
        select: { last_message_at: true },
        where: { store_id: storeId },
        order: { last_message_at: Order.Desc },
        take: 1
      }),
      db.conversations.findMany({
        select: { id: true, handoff_reason: true, last_message_at: true },
        where: { store_id: storeId, handoff_reason: { isIn: ERROR_REASONS }, last_message_at: { gte: since } },
        order: { last_message_at: Order.Desc }
      }),
      db.products.count({ where: { store_id: storeId, active: true } })
    ]);

    return {
      lastMessageAt: latest[0]?.last_message_at ?? null,
      errorCount24h: errors.length,
      recentErrors: errors.slice(0, RECENT_ERRORS).map((error) => ({
        conversationId: error.id,
        reason: error.handoff_reason ?? '',
        at: error.last_message_at
      })),
      activeProducts
    };
  };

  export const setActive = async (db: DbClient, storeId: string, active: boolean) => {
    // `updateOne` returns the record as it was before the update.
    const previous = await db.stores.updateOne({
      select: { ...PANEL_STORE_FIELDS, created_at: true },
      data: { active, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });

    return previous && { ...previous, active };
  };

  export const setAcceptingOrders = async (db: DbClient, storeId: string, accepting: boolean) => {
    await db.stores.updateOne({
      data: { accepting_orders: accepting, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  export const setRouter = async (db: DbClient, storeId: string, router: RouterType) => {
    await db.stores.updateOne({
      data: { router, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  export const setWhatsAppInstance = async (
    db: DbClient,
    storeId: string,
    input: { instance: string; token: string }
  ) => {
    await db.stores.updateOne({
      data: {
        whatsapp_instance: input.instance,
        whatsapp_instance_token: input.token,
        updated_at: new Date().toISOString()
      },
      where: { id: storeId }
    });
  };

  export const getWebhookSecret = async (db: DbClient, storeId: string) => {
    const store = await db.stores.findOne({ select: { whatsapp_webhook_secret: true }, where: { id: storeId } });

    return store?.whatsapp_webhook_secret;
  };

  export const getPolicy = async (db: DbClient, storeId: string): Promise<StorePolicy> => {
    const store = await db.stores.findOne({ select: { policy: true }, where: { id: storeId } });

    return store?.policy ?? {};
  };

  /**
   * Merges the patch into the current policy. Keys set to `null` stay stored as `null` (no limit).
   */
  export const updatePolicy = async (db: DbClient, storeId: string, patch: StorePolicy) => {
    const policy = { ...(await getPolicy(db, storeId)), ...patch };

    await db.stores.updateOne({ data: { policy, updated_at: new Date().toISOString() }, where: { id: storeId } });

    return policy;
  };

  /**
   * Replaces all opening ranges of the store in one transaction: a failed insert keeps the previous week.
   */
  export const replaceHours = async (db: DbClient, storeId: string, hours: HourRange[]) => {
    await db.transaction(async (tx) => {
      await tx.store_hours.deleteMany({ where: { store_id: storeId } });

      for (const hour of hours) {
        await tx.store_hours.insertOne({ data: { id: randomUUID(), store_id: storeId, ...hour } });
      }
    });
  };

  /**
   * Replaces mode, flat fee and neighborhood list in one transaction.
   */
  export const replaceDelivery = async (db: DbClient, storeId: string, delivery: DeliverySettings) => {
    await db.transaction(async (tx) => {
      await tx.stores.updateOne({
        data: {
          delivery_mode: delivery.mode,
          flat_fee_cents: delivery.flatFeeCents,
          updated_at: new Date().toISOString()
        },
        where: { id: storeId }
      });

      await tx.delivery_zones.deleteMany({ where: { store_id: storeId } });

      for (const zone of delivery.zones) {
        await tx.delivery_zones.insertOne({
          data: { id: randomUUID(), store_id: storeId, neighborhood: zone.neighborhood, fee_cents: zone.feeCents }
        });
      }

      await tx.delivery_bands.deleteMany({ where: { store_id: storeId } });

      for (const band of delivery.bands ?? []) {
        await tx.delivery_bands.insertOne({
          data: { id: randomUUID(), store_id: storeId, max_meters: band.maxMeters, fee_cents: band.feeCents }
        });
      }
    });
  };

  /**
   * Distance bands, shortest first.
   */
  export const getBands = async (db: DbClient, storeId: string): Promise<DeliveryBand[]> => {
    const { records } = await db.delivery_bands.findMany({
      select: { max_meters: true, fee_cents: true },
      where: { store_id: storeId },
      order: { max_meters: Order.Asc }
    });

    return records.map(({ max_meters, fee_cents }) => ({ maxMeters: max_meters, feeCents: fee_cents }));
  };

  export const setStoreLocation = async (
    db: DbClient,
    storeId: string,
    location: { address: string; latitude: number; longitude: number }
  ) => {
    await db.stores.updateOne({
      data: { ...location, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  /**
   * Origin of distance delivery; undefined until the store located itself.
   */
  export const getStoreLocation = async (db: DbClient, storeId: string): Promise<Coordinates | undefined> => {
    const store = await db.stores.findOne({ select: { latitude: true, longitude: true }, where: { id: storeId } });

    if (store?.latitude == null || store.longitude == null) {
      return undefined;
    }

    return { latitude: Number(store.latitude), longitude: Number(store.longitude) };
  };

  export const setPaymentMethods = async (db: DbClient, storeId: string, methods: PaymentMethod[]) => {
    await db.stores.updateOne({
      data: { payment_methods: methods, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  export const updateStore = async (
    db: DbClient,
    storeId: string,
    input: { name?: string; acceptingOrders?: boolean }
  ) => {
    await db.stores.updateOne({
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.acceptingOrders !== undefined && { accepting_orders: input.acceptingOrders }),
        updated_at: new Date().toISOString()
      },
      where: { id: storeId }
    });
  };

  /**
   * Everything the settings page edits. Hours sorted by weekday and opening time, zones by name.
   */
  export const getSettings = async (db: DbClient, storeId: string) => {
    const [store, { records: hours }, { records: zones }, bands] = await Promise.all([
      db.stores.findOne({
        select: {
          delivery_mode: true,
          flat_fee_cents: true,
          payment_methods: true,
          policy: true,
          address: true,
          latitude: true,
          longitude: true,
          stock_alert_phone: true,
          stock_alert_hour: true,
          pos_layout: true,
          pos_cash_control: true,
          pos_blind_close: true,
          pos_receipt_width: true
        },
        where: { id: storeId }
      }),
      db.store_hours.findMany({
        select: { weekday: true, opens_at: true, closes_at: true },
        where: { store_id: storeId },
        order: { weekday: Order.Asc, opens_at: Order.Asc }
      }),
      db.delivery_zones.findMany({
        select: { neighborhood: true, fee_cents: true },
        where: { store_id: storeId },
        order: { neighborhood: Order.Asc }
      }),
      getBands(db, storeId)
    ]);

    if (!store) {
      return undefined;
    }

    return {
      hours,
      delivery: {
        mode: store.delivery_mode,
        flatFeeCents: store.flat_fee_cents,
        zones: zones.map(({ neighborhood, fee_cents }) => ({ neighborhood, feeCents: fee_cents })),
        bands
      },
      storeLocation:
        store.address && store.latitude != null && store.longitude != null
          ? { address: store.address, latitude: Number(store.latitude), longitude: Number(store.longitude) }
          : null,
      paymentMethods: store.payment_methods,
      policy: store.policy ?? {},
      stockAlertPhone: store.stock_alert_phone ?? null,
      stockAlertHour: store.stock_alert_hour ?? null,
      pos: resolvePos(store)
    };
  };

  const resolvePos = (store: {
    pos_layout?: 'grid' | 'search' | null;
    pos_cash_control?: boolean | null;
    pos_blind_close?: boolean | null;
    pos_receipt_width?: number | null;
  }): PosSettings => ({
    layout: store.pos_layout ?? 'grid',
    cashControl: store.pos_cash_control ?? true,
    blindClose: store.pos_blind_close ?? false,
    receiptWidth: store.pos_receipt_width === 58 ? 58 : 80
  });

  export const getPosSettings = async (db: DbClient, storeId: string): Promise<PosSettings> => {
    const store = await db.stores.findOne({
      select: { pos_layout: true, pos_cash_control: true, pos_blind_close: true, pos_receipt_width: true },
      where: { id: storeId }
    });

    return resolvePos(store ?? {});
  };

  export const setPosSettings = async (db: DbClient, storeId: string, settings: PosSettings) => {
    await db.stores.updateOne({
      data: {
        pos_layout: settings.layout,
        pos_cash_control: settings.cashControl,
        pos_blind_close: settings.blindClose,
        pos_receipt_width: settings.receiptWidth,
        updated_at: new Date().toISOString()
      },
      where: { id: storeId }
    });
  };

  export const setStockAlert = async (
    db: DbClient,
    storeId: string,
    input: { phone: string | null; hour: number | null }
  ) => {
    await db.stores.updateOne({
      data: { stock_alert_phone: input.phone, stock_alert_hour: input.hour, updated_at: new Date().toISOString() },
      where: { id: storeId }
    });
  };

  export const getHours = async (db: DbClient, storeId: string) => {
    const { records } = await db.store_hours.findMany({
      select: { weekday: true, opens_at: true, closes_at: true },
      where: { store_id: storeId },
      order: { weekday: Order.Asc, opens_at: Order.Asc }
    });

    return records as HourRange[];
  };

  export const getWhatsAppInstance = async (db: DbClient, storeId: string) => {
    const store = await db.stores.findOne({
      select: { whatsapp_instance: true, whatsapp_instance_token: true, whatsapp_webhook_secret: true },
      where: { id: storeId }
    });

    if (!store) {
      return undefined;
    }

    return {
      instance: store.whatsapp_instance ?? null,
      token: store.whatsapp_instance_token ?? null,
      webhookSecret: store.whatsapp_webhook_secret
    };
  };
}
