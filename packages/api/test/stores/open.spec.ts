import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openOverrideUntil, storeOpenState } from '../../src/stores/open';

const TZ = 'America/Sao_Paulo';

// 2026-10-09 is a Friday (weekday 5). São Paulo is UTC-3.
const hours = [
  { weekday: 5, opens_at: '18:00', closes_at: '23:00' },
  { weekday: 6, opens_at: '18:00', closes_at: '23:00' }
];

const closedNow = new Date('2026-10-09T13:00:00Z');
const openNow = new Date('2026-10-09T23:00:00Z');
const store = { timezone: TZ, accepting_orders: true };

describe('storeOpenState', () => {
  it('follows the hours without a manual choice', () => {
    deepEqual(storeOpenState(store, hours, openNow), { open: true, override: null, until: null });
    equal(storeOpenState(store, hours, closedNow).open, false);
  });

  it('keeps a manual choice until it ends', () => {
    const until = '2026-10-09T21:00:00.000Z';
    const forced = { ...store, open_override: true, open_override_until: until };

    deepEqual(storeOpenState(forced, hours, closedNow), { open: true, override: true, until });
    deepEqual(storeOpenState(forced, hours, new Date(until)), { open: true, override: null, until: null });

    const closed = { ...store, open_override: false, open_override_until: null };

    deepEqual(storeOpenState(closed, hours, openNow), { open: false, override: false, until: null });
  });

  it('treats the legacy pause as closed by hand', () => {
    const paused = { ...store, accepting_orders: false, open_override: true };

    deepEqual(storeOpenState(paused, hours, openNow), { open: false, override: false, until: null });
  });
});

describe('openOverrideUntil', () => {
  it('ends a manual close at the next opening', () => {
    equal(openOverrideUntil(false, hours, TZ, openNow), '2026-10-10T21:00:00.000Z');
    equal(openOverrideUntil(false, hours, TZ, closedNow), '2026-10-09T21:00:00.000Z');
  });

  it('ends a manual open at the next closing, or at the next opening when the hours say closed', () => {
    equal(openOverrideUntil(true, hours, TZ, openNow), '2026-10-10T02:00:00.000Z');
    equal(openOverrideUntil(true, hours, TZ, closedNow), '2026-10-09T21:00:00.000Z');
  });

  it('never ends without hours', () => {
    equal(openOverrideUntil(true, [], TZ, openNow), null);
  });
});
