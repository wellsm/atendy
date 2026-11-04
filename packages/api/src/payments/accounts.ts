import type { DbClient } from '../db';

import { randomUUID } from 'node:crypto';

import { notifyAdmin } from '../admin/telegram';

const ACCOUNT_FIELDS = {
  id: true,
  owner_user_id: true,
  asaas_customer_id: true,
  asaas_subscription_id: true,
  card_brand: true,
  card_last4: true
} as const;

export type BillingAccount = {
  id: string;
  owner_user_id: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
};

const toAccount = (row: { id: string } & { [K in Exclude<keyof BillingAccount, 'id'>]?: string | null }) =>
  ({
    id: row.id,
    owner_user_id: row.owner_user_id ?? null,
    asaas_customer_id: row.asaas_customer_id ?? null,
    asaas_subscription_id: row.asaas_subscription_id ?? null,
    card_brand: row.card_brand ?? null,
    card_last4: row.card_last4 ?? null
  }) satisfies BillingAccount;

export namespace BillingAccounts {
  /**
   * The store's billing account, created on first use under the store lock with the Asaas customer, subscription and
   * card the store had before accounts existed.
   */
  export const ensure = async (db: DbClient, storeId: string): Promise<BillingAccount> => {
    const store = await db.stores.findOne({ select: { billing_account_id: true }, where: { id: storeId } });

    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    if (store.billing_account_id) {
      const account = await db.billing_accounts.findOne({
        select: ACCOUNT_FIELDS,
        where: { id: store.billing_account_id }
      });

      if (account) {
        return toAccount(account);
      }
    }

    return db.transaction(async (tx) => {
      const locked = await tx.stores.findOne({
        select: {
          billing_account_id: true,
          asaas_customer_id: true,
          asaas_subscription_id: true,
          card_brand: true,
          card_last4: true
        },
        where: { id: storeId },
        lock: true
      });

      if (locked?.billing_account_id) {
        const account = await tx.billing_accounts.findOne({
          select: ACCOUNT_FIELDS,
          where: { id: locked.billing_account_id }
        });

        if (account) {
          return toAccount(account);
        }
      }

      const now = new Date().toISOString();

      const account = toAccount({
        id: randomUUID(),
        asaas_customer_id: locked?.asaas_customer_id,
        asaas_subscription_id: locked?.asaas_subscription_id,
        card_brand: locked?.card_brand,
        card_last4: locked?.card_last4
      });

      await tx.billing_accounts.insertOne({ data: { ...account, created_at: now, updated_at: now } });
      await tx.stores.updateOne({ data: { billing_account_id: account.id }, where: { id: storeId } });

      return account;
    });
  };

  /**
   * Ids of every store the account pays for.
   */
  export const storeIds = async (db: DbClient, accountId: string) => {
    const { records } = await db.stores.findMany({ select: { id: true }, where: { billing_account_id: accountId } });

    return records.map(({ id }) => id);
  };

  /**
   * A user got the store (created it in the panel, or the admin gave it to them). The first user wins: an owned store
   * never moves. It joins the user's account, unless both already have a card (never cancel a live subscription).
   */
  export const assignOwner = async (db: DbClient, storeId: string, userId: string) => {
    const account = await ensure(db, storeId);

    if (account.owner_user_id) {
      return;
    }

    const now = new Date().toISOString();
    const owned = await db.billing_accounts.findOne({ select: ACCOUNT_FIELDS, where: { owner_user_id: userId } });

    if (!owned) {
      await db.billing_accounts.updateOne({
        data: { owner_user_id: userId, updated_at: now },
        where: { id: account.id }
      });

      return;
    }

    if (owned.asaas_subscription_id && account.asaas_subscription_id) {
      await notifyAdmin(
        `Atendy: a loja ${storeId} ficou com cobrança separada: ela e a conta do dono já têm cartão (conta ${owned.id}).`
      );

      return;
    }

    await db.transaction(async (tx) => {
      // The joining store brings its card to an account without one.
      if (account.asaas_subscription_id) {
        await tx.billing_accounts.updateOne({
          data: {
            asaas_customer_id: account.asaas_customer_id,
            asaas_subscription_id: account.asaas_subscription_id,
            card_brand: account.card_brand,
            card_last4: account.card_last4,
            updated_at: now
          },
          where: { id: owned.id }
        });
      }

      await tx.stores.updateMany({ data: { billing_account_id: owned.id }, where: { billing_account_id: account.id } });
      await tx.billing_accounts.deleteOne({ where: { id: account.id } });
    });
  };
}
