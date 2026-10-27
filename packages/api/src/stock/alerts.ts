import type { DbClient } from '../db';
import type { WhatsAppProvider } from '../whatsapp/types';

import { StockRepository } from './repository';
import { StockFilter, StockUnit } from './types';
import { notifyAdmin } from '../admin/telegram';
import { EvolutionRequestError } from '../whatsapp/evolution-client';
import { WhatsAppProviders } from '../whatsapp/providers';

const DEFAULT_ALERT_HOUR = 9;

const MAX_LINES = 20;

type DigestItem = { name: string; unit: StockUnit; balance: number; minQty: number | null };

const formatNumber = (value: number) => {
  const rounded = Math.round(value * 10) / 10;

  return String(rounded).replace('.', ',');
};

const formatQty = (qty: number, unit: StockUnit, withUnit: boolean) => {
  if (unit === StockUnit.Gram) {
    return Math.abs(qty) >= 1000 ? `${formatNumber(qty / 1000)} kg` : `${formatNumber(qty)} g`;
  }

  if (unit === StockUnit.Milliliter) {
    return Math.abs(qty) >= 1000 ? `${formatNumber(qty / 1000)} L` : `${formatNumber(qty)} ml`;
  }

  return withUnit ? `${formatNumber(qty)} un` : formatNumber(qty);
};

export const formatLowStockDigest = (items: DigestItem[], url: string) => {
  const lines = items.slice(0, MAX_LINES).map((item) => {
    const min = item.minQty === null ? '' : ` (mín. ${formatQty(item.minQty, item.unit, false)})`;

    return `• ${item.name}: ${formatQty(item.balance, item.unit, true)}${min}`;
  });

  const extra = items.length - MAX_LINES;

  if (extra > 0) {
    lines.push(`… e mais ${extra} ${extra === 1 ? 'item' : 'itens'}`);
  }

  return `📦 *Estoque baixo*\n\n${lines.join('\n')}\n\nVer no painel: ${url}`;
};

const localMoment = (now: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
};

/**
 * Hourly: one WhatsApp digest per store and local day with the low-stock items, sent from the store's own number to
 * `stock_alert_phone`. Never writes `messages` (the webhook drops the `fromMe` echo).
 */
export const runStockAlerts = async (
  db: DbClient,
  env: { EVOLUTION_API_URL?: string; WEB_BASE_URL: string },
  now: Date,
  storeIds?: string[]
) => {
  const sent: string[] = [];

  const { records } = await db.stores.findMany({
    select: {
      id: true,
      slug: true,
      timezone: true,
      active: true,
      billing_blocked: true,
      whatsapp_provider: true,
      whatsapp_instance: true,
      whatsapp_instance_token: true,
      stock_alert_phone: true,
      stock_alert_hour: true,
      stock_alert_sent_on: true
    },
    where: { active: true, stock_alert_phone: { isNull: false } }
  });

  for (const store of records) {
    if (!store.stock_alert_phone || store.billing_blocked || (storeIds && !storeIds.includes(store.id))) {
      continue;
    }

    const local = localMoment(now, store.timezone);

    if (local.hour < (store.stock_alert_hour ?? DEFAULT_ALERT_HOUR) || store.stock_alert_sent_on === local.date) {
      continue;
    }

    let provider: WhatsAppProvider;

    try {
      provider = WhatsAppProviders.forStore(store, env);
    } catch {
      // Not connected: nothing to send and nothing to mark.
      continue;
    }

    const previous = store.stock_alert_sent_on ?? null;

    try {
      const items = await StockRepository.listItems(db, store.id, StockFilter.Low);

      if (items.length === 0) {
        continue;
      }

      // Claim the day before sending, so overlapping runs or a crash after the send never repeat the digest.
      const claimed = await db.transaction(async (tx) => {
        const current = await tx.stores.findOne({
          select: { stock_alert_sent_on: true },
          where: { id: store.id },
          lock: true
        });

        if (!current || current.stock_alert_sent_on === local.date) {
          return false;
        }

        await tx.stores.updateOne({ data: { stock_alert_sent_on: local.date }, where: { id: store.id } });

        return true;
      });

      if (!claimed) {
        continue;
      }

      const url = `${env.WEB_BASE_URL}/panel/${store.slug}?sheet=stock&filter=low`;

      try {
        await provider.sendText({ to: store.stock_alert_phone, text: formatLowStockDigest(items, url) });
      } catch (error) {
        if (error instanceof EvolutionRequestError) {
          // The provider refused it: nothing was sent, so the next hourly run retries.
          await db.stores.updateOne({ data: { stock_alert_sent_on: previous }, where: { id: store.id } });
          continue;
        }

        throw error;
      }

      sent.push(store.id);
    } catch (error) {
      // The claim stays (at most one digest a day); one store's failure never stops the others.
      await notifyAdmin(`Stock alert failed for ${store.slug}: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  return { sent };
};
