import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatHours, isClosingSoon, isStoreOpen } from '../../src/stores/hours';

const TZ = 'America/Sao_Paulo';

// 2026-10-09 is a Friday (weekday 5). São Paulo is UTC-3 (no DST).
describe('isStoreOpen', () => {
  const evening = [{ weekday: 5, opens_at: '18:00', closes_at: '23:00' }];

  it('uses the store timezone, not UTC', () => {
    equal(isStoreOpen(evening, TZ, new Date('2026-10-09T20:30:00Z')), false);
    equal(isStoreOpen(evening, TZ, new Date('2026-10-09T21:30:00Z')), true);
  });

  it('treats closes_at as exclusive', () => {
    equal(isStoreOpen(evening, TZ, new Date('2026-10-10T01:59:00Z')), true);
    equal(isStoreOpen(evening, TZ, new Date('2026-10-10T02:00:00Z')), false);
  });

  it('keeps an overnight range open after midnight on the next weekday', () => {
    const overnight = [{ weekday: 5, opens_at: '18:00', closes_at: '02:00' }];

    // Saturday 01:00 local
    equal(isStoreOpen(overnight, TZ, new Date('2026-10-10T04:00:00Z')), true);
    // Saturday 02:00 local
    equal(isStoreOpen(overnight, TZ, new Date('2026-10-10T05:00:00Z')), false);
    // Friday 01:00 local belongs to Thursday's range, which does not exist
    equal(isStoreOpen(overnight, TZ, new Date('2026-10-09T04:00:00Z')), false);
  });

  it('wraps Saturday overnight into Sunday', () => {
    const saturday = [{ weekday: 6, opens_at: '18:00', closes_at: '01:00' }];

    // Sunday 00:30 local
    equal(isStoreOpen(saturday, TZ, new Date('2026-10-11T03:30:00Z')), true);
  });

  it('supports several ranges in the same day', () => {
    const split = [
      { weekday: 5, opens_at: '11:00', closes_at: '14:00' },
      { weekday: 5, opens_at: '18:00', closes_at: '23:00' }
    ];

    equal(isStoreOpen(split, TZ, new Date('2026-10-09T15:00:00Z')), true);
    equal(isStoreOpen(split, TZ, new Date('2026-10-09T18:00:00Z')), false);
  });

  it('is closed when there are no hours', () => {
    equal(isStoreOpen([], TZ, new Date('2026-10-09T21:30:00Z')), false);
  });
});

describe('formatHours', () => {
  it('groups ranges by weekday in Sunday-first order and marks days without hours as closed', () => {
    equal(
      formatHours([
        { weekday: 5, opens_at: '18:00', closes_at: '23:00' },
        { weekday: 5, opens_at: '11:00', closes_at: '14:00' },
        { weekday: 0, opens_at: '18:00', closes_at: '22:00' }
      ]),
      [
        'Dom 18:00–22:00',
        'Seg fechado',
        'Ter fechado',
        'Qua fechado',
        'Qui fechado',
        'Sex 11:00–14:00, 18:00–23:00',
        'Sáb fechado'
      ].join('\n')
    );
  });
});

describe('isClosingSoon', () => {
  const evening = [{ weekday: 5, opens_at: '18:00', closes_at: '23:00' }];

  it('is true only inside the last minutes before closing', () => {
    // Friday 22:20 local
    equal(isClosingSoon(evening, TZ, new Date('2026-10-10T01:20:00Z'), 30), false);
    // Friday 22:40 local
    equal(isClosingSoon(evening, TZ, new Date('2026-10-10T01:40:00Z'), 30), true);
    // Friday 23:10 local, already closed
    equal(isClosingSoon(evening, TZ, new Date('2026-10-10T02:10:00Z'), 30), false);
  });

  it('never closes a store open around the clock', () => {
    const always = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '00:00' }));

    // Friday 23:50 local
    equal(isClosingSoon(always, TZ, new Date('2026-10-10T02:50:00Z'), 30), false);
  });
});
