import { CHARGE_DAY, GRACE_DAYS } from './types';

/**
 * Brazil has no daylight saving time since 2019: cycles use a fixed UTC−3 offset.
 */
const OFFSET_MS = 3 * 60 * 60_000;

const DAY_MS = 86_400_000;

/**
 * YYYY-MM-DD of a calendar day; out-of-range months roll over (month 12 = January of the next year).
 */
const toDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

/**
 * Day 1 00:00 (UTC−3) of the given month, as an ISO instant.
 */
const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month, 1) + OFFSET_MS).toISOString();

const local = (now: Date) => new Date(now.getTime() - OFFSET_MS);

/**
 * The cycle that ended before `now` (the previous calendar month in Brazil) and its charge date.
 */
export const previousCycle = (now: Date) => {
  const today = local(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  return {
    periodStart: monthStart(year, month - 1),
    periodEnd: monthStart(year, month),
    dueDate: toDate(year, month, CHARGE_DAY)
  };
};

/**
 * First charge date of a new card subscription: the charge day after the current cycle closes.
 */
export const firstChargeDate = (now: Date) => {
  const today = local(now);

  return toDate(today.getUTCFullYear(), today.getUTCMonth() + 1, CHARGE_DAY);
};

/**
 * Today in Brazil (YYYY-MM-DD).
 */
export const localToday = (now: Date) => local(now).toISOString().slice(0, 10);

/**
 * An invoice due on `dueDate` and still unpaid blocks the store once the grace days are over.
 */
export const isPastGrace = (dueDate: string, now: Date) =>
  Date.parse(`${localToday(now)}T00:00:00Z`) > Date.parse(`${dueDate}T00:00:00Z`) + GRACE_DAYS * DAY_MS;

/**
 * The calendar month (YYYY-MM) of `now` in Brazil.
 */
export const localMonth = (now: Date) => local(now).toISOString().slice(0, 7);

/**
 * Bounds of a billing cycle (YYYY-MM): day 1 00:00 to the next day 1, UTC−3.
 */
export const monthCycle = (month: string) => {
  const [year, index] = month.split('-').map(Number) as [number, number];

  return { periodStart: monthStart(year, index - 1), periodEnd: monthStart(year, index) };
};

/**
 * Brazil's calendar day (YYYY-MM-DD) of an instant.
 */
export const localDay = (iso: string) => local(new Date(iso)).toISOString().slice(0, 10);
