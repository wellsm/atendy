import type { DbClient } from '../db';
import type { ProspectPauseReason, SendWindow } from './types';

import { dailyCap } from './pacing';
import { ProspectingRepository } from './repository';
import { ProspectStatus } from './types';

export type ProspectingSummary = {
  sender: {
    connected: boolean;
    paused: boolean;
    pauseReason: ProspectPauseReason | null;
    maxDaily: number;
    window: SendWindow;
    nextSendAt: string | null;
  };
  counts: {
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
  sentToday: number;
  capToday: number;
  /**
   * Replied ÷ leads we messaged (manual ones excluded); null before the first send.
   */
  replyRate: number | null;
};

/**
 * What the admin screen shows: the single sender, lead counts per status and the day's pacing.
 */
export const loadProspectingSummary = async (db: DbClient, now: Date): Promise<ProspectingSummary> => {
  const [sender, counts, sentToday] = await Promise.all([
    ProspectingRepository.getSender(db),
    ProspectingRepository.counts(db),
    ProspectingRepository.sentOn(db, now)
  ]);

  const messaged = counts.sent + counts.delivered + counts.read + counts.replied;

  return {
    sender: {
      connected: sender.connected,
      paused: sender.paused,
      pauseReason: sender.pauseReason,
      maxDaily: sender.maxDaily,
      window: sender.window,
      nextSendAt: sender.nextSendAt
    },
    counts: {
      available: counts[ProspectStatus.Available],
      queued: counts[ProspectStatus.Queued],
      sending: counts[ProspectStatus.Sending],
      sent: counts[ProspectStatus.Sent],
      delivered: counts[ProspectStatus.Delivered],
      read: counts[ProspectStatus.Read],
      replied: counts[ProspectStatus.Replied],
      failed: counts[ProspectStatus.Failed],
      canceled: counts[ProspectStatus.Canceled],
      manual: counts[ProspectStatus.Manual]
    },
    sentToday,
    capToday: dailyCap(sender.firstSentAt, now, sender.maxDaily),
    replyRate: messaged === 0 ? null : counts.replied / messaged
  };
};
