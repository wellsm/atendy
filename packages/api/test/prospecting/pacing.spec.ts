import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dailyCap,
  isInWindow,
  isLowReplies,
  nextWindowStart,
  sendGapMs,
  typingDelayMs,
  windowJitterMs
} from '../../src/prospecting/pacing';
import { DEFAULT_WINDOW } from '../../src/prospecting/types';

describe('prospecting pacing', () => {
  it('opens the window at 10:00 and closes it at 18:00 (UTC−3), Monday to Saturday', () => {
    equal(isInWindow(new Date('2026-10-21T12:59:00Z'), DEFAULT_WINDOW), false);
    equal(isInWindow(new Date('2026-10-21T13:00:00Z'), DEFAULT_WINDOW), true);
    equal(isInWindow(new Date('2026-10-21T20:59:00Z'), DEFAULT_WINDOW), true);
    equal(isInWindow(new Date('2026-10-21T21:00:00Z'), DEFAULT_WINDOW), false);
    equal(isInWindow(new Date('2026-10-25T15:00:00Z'), DEFAULT_WINDOW), false);
  });

  it('finds the next window start strictly after now', () => {
    const next = (iso: string) => nextWindowStart(new Date(iso), DEFAULT_WINDOW).toISOString();

    equal(next('2026-10-21T22:00:00Z'), '2026-10-22T13:00:00.000Z');
    equal(next('2026-10-24T22:00:00Z'), '2026-10-26T13:00:00.000Z');
    equal(next('2026-10-21T11:00:00Z'), '2026-10-21T13:00:00.000Z');
    equal(next('2026-10-21T13:00:00Z'), '2026-10-22T13:00:00.000Z');
  });

  it('caps daily sends at 20 in week one and grows 10 per week up to the maximum', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

    equal(dailyCap(null, now, 50), 20);
    equal(dailyCap(ago(6), now, 50), 20);
    equal(dailyCap(ago(7), now, 50), 30);
    equal(dailyCap(ago(21), now, 50), 50);
    equal(dailyCap(ago(70), now, 50), 50);
    equal(dailyCap(ago(7), now, 25), 25);
  });

  it('keeps random delays inside their bounds', () => {
    equal(
      sendGapMs(() => 0),
      120_000
    );
    equal(sendGapMs(() => 0.999999) < 360_001, true);
    equal(
      typingDelayMs(() => 0),
      2_000
    );
    equal(typingDelayMs(() => 0.999999) < 5_001, true);
    equal(
      windowJitterMs(() => 0),
      0
    );
    equal(windowJitterMs(() => 0.999999) < 1_200_001, true);
  });

  it('flags low reply rates only after 30 sends and below 5 %', () => {
    equal(isLowReplies({ sent: 29, replied: 0 }), false);
    equal(isLowReplies({ sent: 30, replied: 1 }), true);
    equal(isLowReplies({ sent: 40, replied: 2 }), false);
  });
});
