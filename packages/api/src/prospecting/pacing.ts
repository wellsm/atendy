import type { SendWindow } from './types';

import { localDay, localToday } from '../payments/cycle';

/**
 * Same fixed UTC−3 offset as the billing cycles.
 */
const OFFSET_MS = 3 * 60 * 60_000;

const DAY_MS = 86_400_000;

const FIRST_WEEK_CAP = 20;

const WEEKLY_CAP_STEP = 10;

const MIN_REPLIED_SAMPLE = 30;

const MIN_REPLY_RATE = 0.05;

const local = (now: Date) => new Date(now.getTime() - OFFSET_MS);

const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1));

export const isInWindow = (now: Date, window: SendWindow) => {
  const date = local(now);
  const hour = date.getUTCHours();

  return window.weekdays.includes(date.getUTCDay()) && hour >= window.startHour && hour < window.endHour;
};

/**
 * The first window opening strictly after `now`.
 */
export const nextWindowStart = (now: Date, window: SendWindow) => {
  const date = local(now);

  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
    const start = new Date(day.getTime() + window.startHour * 3_600_000 + OFFSET_MS);

    if (window.weekdays.includes(day.getUTCDay()) && start.getTime() > now.getTime()) {
      return start;
    }
  }

  throw new Error('The send window has no weekdays.');
};

/**
 * Warm-up: 20 sends a day in the first week, +10 each following week, never above `maxDaily`.
 */
export const dailyCap = (firstSentAt: string | null, now: Date, maxDaily: number) => {
  if (!firstSentAt) {
    return Math.min(FIRST_WEEK_CAP, maxDaily);
  }

  const days = Math.round((Date.parse(localToday(now)) - Date.parse(localDay(firstSentAt))) / DAY_MS);
  const weeks = Math.max(0, Math.floor(days / 7));

  return Math.min(FIRST_WEEK_CAP + weeks * WEEKLY_CAP_STEP, maxDaily);
};

export const sendGapMs = (random: () => number) => between(random, 120_000, 360_000);

export const typingDelayMs = (random: () => number) => between(random, 2_000, 5_000);

export const windowJitterMs = (random: () => number) => between(random, 0, 1_200_000);

export const isLowReplies = (sample: { sent: number; replied: number }) =>
  sample.sent >= MIN_REPLIED_SAMPLE && sample.replied / sample.sent < MIN_REPLY_RATE;
