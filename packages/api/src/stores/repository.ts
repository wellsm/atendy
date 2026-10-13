import type { DbClient } from '../db';
import type { HourRange } from './hours';
import type { DeliverySettings } from './settings';
import type { StorePolicy } from './types';

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

  /**
   * Inactive stores first (waiting for the admin), newest first.
   */
  export const listForAdmin = async (db: DbClient) => {
    const { records } = await db.stores.findMany({
      select: { ...PANEL_STORE_FIELDS, created_at: true },
      order: { created_at: Order.Desc }
    });

    return records.sort((a, b) => Number(a.active) - Number(b.active));
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
    });
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
    const [store, { records: hours }, { records: zones }] = await Promise.all([
      db.stores.findOne({
        select: { delivery_mode: true, flat_fee_cents: true, payment_methods: true, policy: true },
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
      })
    ]);

    if (!store) {
      return undefined;
    }

    return {
      hours,
      delivery: {
        mode: store.delivery_mode,
        flatFeeCents: store.flat_fee_cents,
        zones: zones.map(({ neighborhood, fee_cents }) => ({ neighborhood, feeCents: fee_cents }))
      },
      paymentMethods: store.payment_methods,
      policy: store.policy ?? {}
    };
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
