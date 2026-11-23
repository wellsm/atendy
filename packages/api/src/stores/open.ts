import type { HourRange } from './hours';

import { isStoreOpen, nextScheduleChange } from './hours';

export type StoreOpenFields = {
  timezone: string;
  /**
   * Legacy pause: `false` is closed by hand without expiry (new stores start with it).
   */
  accepting_orders: boolean;
  open_override?: boolean | null;
  open_override_until?: string | null;
};

export type StoreOpenState = {
  open: boolean;
  /**
   * The manual choice in force; null = following the hours.
   */
  override: boolean | null;
  /**
   * When the manual choice ends; null = no expiry (or no manual choice).
   */
  until: string | null;
};

/**
 * Whether the store takes orders now: its manual Aberto/Fechado while it lasts, else its hours. The only place that
 * decides it (bot, public menu, web orders, panel).
 */
export const storeOpenState = (store: StoreOpenFields, hours: HourRange[], now = new Date()): StoreOpenState => {
  if (!store.accepting_orders) {
    return { open: false, override: false, until: null };
  }

  const override = store.open_override ?? null;
  const until = store.open_override_until ?? null;

  if (override !== null && (!until || Date.parse(until) > now.getTime())) {
    return { open: override, override, until };
  }

  return { open: isStoreOpen(hours, store.timezone, now), override: null, until: null };
};

/**
 * When a manual choice made now ends: "Fechado" at the next scheduled opening; "Aberto" at the next scheduled closing
 * when the hours say open, else at the next scheduled opening (the hours take over there). Null = never.
 */
export const openOverrideUntil = (open: boolean, hours: HourRange[], timeZone: string, now = new Date()) =>
  nextScheduleChange(hours, timeZone, now, open ? !isStoreOpen(hours, timeZone, now) : true);
