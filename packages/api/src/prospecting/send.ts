import type { DbClient } from '../db';

import {
  dailyCap,
  isInWindow,
  isLowReplies,
  nextWindowStart,
  sendGapMs,
  typingDelayMs,
  windowJitterMs
} from './pacing';
import { ProspectingRepository } from './repository';
import { ProspectPauseReason } from './types';
import { EvolutionClient, EvolutionRequestError } from '../whatsapp/evolution-client';

export const enum SendOutcome {
  Paused = 'paused',
  Waiting = 'waiting',
  OutsideWindow = 'outside_window',
  CapReached = 'cap_reached',
  Braked = 'braked',
  Empty = 'empty',
  Sent = 'sent',
  Failed = 'failed'
}

const MAX_FAILURES = 3;

const NOT_ON_WHATSAPP_REASON = 'Número sem WhatsApp';

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

/**
 * One scheduler tick: sends at most one first message. Check order (see the spec): paused/disconnected, next_send_at,
 * window, daily cap, low-reply brake, claim, send.
 */
export const runSend = async (
  db: DbClient,
  env: { EVOLUTION_API_URL?: string },
  now: Date,
  random: () => number = Math.random
): Promise<SendOutcome> => {
  const sender = await ProspectingRepository.getSender(db);

  if (sender.paused || !sender.connected || !sender.instance || !sender.token) {
    return SendOutcome.Paused;
  }

  if (sender.nextSendAt && now.getTime() < Date.parse(sender.nextSendAt)) {
    return SendOutcome.Waiting;
  }

  const nextDay = () => new Date(nextWindowStart(now, sender.window).getTime() + windowJitterMs(random)).toISOString();

  if (!isInWindow(now, sender.window)) {
    await ProspectingRepository.setSenderState(db, { nextSendAt: nextDay() });

    return SendOutcome.OutsideWindow;
  }

  const sentToday = await ProspectingRepository.sentOn(db, now);

  if (sentToday >= dailyCap(sender.firstSentAt, now, sender.maxDaily)) {
    await ProspectingRepository.setSenderState(db, { nextSendAt: nextDay() });

    return SendOutcome.CapReached;
  }

  const sample = await ProspectingRepository.replySample(db, sender.brakeSince, now);

  if (isLowReplies(sample)) {
    await ProspectingRepository.setSenderState(db, { paused: true, pauseReason: ProspectPauseReason.LowReplies });

    return SendOutcome.Braked;
  }

  if (!env.EVOLUTION_API_URL) {
    throw new Error('EVOLUTION_API_URL is not set');
  }

  // The claim re-checks the locked sender row and reserves the gap in the same transaction: overlapping runs, a crash
  // or a slow send never let another message go out right behind this one.
  const lead = await ProspectingRepository.claimNext(db, now, sendGapMs(random));

  if (!lead) {
    return SendOutcome.Empty;
  }

  const text = lead.messages[Math.floor(random() * lead.messages.length)]!;

  let providerMessageId: string;

  try {
    ({ providerMessageId } = await EvolutionClient.sendText({
      baseUrl: env.EVOLUTION_API_URL,
      instance: sender.instance,
      token: sender.token,
      to: lead.phone,
      text,
      delayMs: typingDelayMs(random)
    }));
  } catch (error) {
    const known = error instanceof EvolutionRequestError;

    // Not the sender's fault: the lead fails and the failure streak stays as it is.
    if (known && error.notOnWhatsApp) {
      await ProspectingRepository.markFailed(db, lead.id, NOT_ON_WHATSAPP_REASON);

      return SendOutcome.Failed;
    }

    // Only a permanent error (4xx) fails the lead. A timeout, network error, 5xx or 200 without a message id may have
    // delivered it: the lead stays `sending` (stuck after `STUCK_SENDING_MS`, "Envio incerto"), never re-sent on its own.
    if (known && error.permanent) {
      await ProspectingRepository.markFailed(db, lead.id, reasonOf(error));
    }

    const failures = sender.consecutiveFailures + 1;

    await ProspectingRepository.setSenderState(db, {
      consecutiveFailures: failures,
      ...(failures >= MAX_FAILURES && { paused: true, pauseReason: ProspectPauseReason.Failures })
    });

    return SendOutcome.Failed;
  }

  // The message is out: whatever happens next, the lead is never sent again.
  await ProspectingRepository.markSent(db, lead.id, { text, providerMessageId, at: now });

  await ProspectingRepository.setSenderState(db, {
    consecutiveFailures: 0,
    ...(!sender.firstSentAt && { firstSentAt: now.toISOString() })
  });

  return SendOutcome.Sent;
};
