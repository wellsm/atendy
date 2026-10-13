import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SettingsError,
  validateDelivery,
  validateHours,
  validatePaymentMethods,
  validateStoreName
} from '../../src/stores/settings';
import { DeliveryMode, PaymentMethod } from '../../src/stores/types';

const failsOn = (field: string) => (error: unknown) => error instanceof SettingsError && error.field === field;

describe('settings validators', () => {
  it('accepts overnight and 24h ranges and sorts them', () => {
    deepEqual(
      validateHours([
        { weekday: 6, opens_at: '00:00', closes_at: '00:00' },
        { weekday: 5, opens_at: '18:00', closes_at: '02:00' },
        { weekday: 5, opens_at: '11:00', closes_at: '14:00' }
      ]),
      [
        { weekday: 5, opens_at: '11:00', closes_at: '14:00' },
        { weekday: 5, opens_at: '18:00', closes_at: '02:00' },
        { weekday: 6, opens_at: '00:00', closes_at: '00:00' }
      ]
    );
  });

  it('does not treat the next-day part of an overnight range as an overlap', () => {
    equal(
      validateHours([
        { weekday: 5, opens_at: '18:00', closes_at: '02:00' },
        { weekday: 6, opens_at: '01:00', closes_at: '03:00' }
      ]).length,
      2
    );
  });

  it('rejects ranges of the same weekday that overlap', () => {
    throws(
      () =>
        validateHours([
          { weekday: 1, opens_at: '11:00', closes_at: '15:00' },
          { weekday: 1, opens_at: '14:00', closes_at: '18:00' }
        ]),
      failsOn('hours')
    );

    throws(
      () =>
        validateHours([
          { weekday: 1, opens_at: '18:00', closes_at: '02:00' },
          { weekday: 1, opens_at: '20:00', closes_at: '23:00' }
        ]),
      failsOn('hours')
    );

    throws(
      () =>
        validateHours([
          { weekday: 2, opens_at: '00:00', closes_at: '00:00' },
          { weekday: 2, opens_at: '10:00', closes_at: '11:00' }
        ]),
      failsOn('hours')
    );
  });

  it('rejects a bad weekday or time', () => {
    throws(() => validateHours([{ weekday: 7, opens_at: '11:00', closes_at: '15:00' }]), failsOn('hours'));
    throws(() => validateHours([{ weekday: 1.5, opens_at: '11:00', closes_at: '15:00' }]), failsOn('hours'));
    throws(() => validateHours([{ weekday: 1, opens_at: '25:00', closes_at: '15:00' }]), failsOn('hours'));
    throws(() => validateHours([{ weekday: 1, opens_at: '11:00', closes_at: '9:00' }]), failsOn('hours'));
  });

  it('requires a zone in by_zone mode and rejects duplicates after normalizing', () => {
    throws(() => validateDelivery({ mode: DeliveryMode.ByZone, flatFeeCents: 0, zones: [] }), failsOn('zones'));

    throws(
      () =>
        validateDelivery({
          mode: DeliveryMode.ByZone,
          flatFeeCents: 0,
          zones: [
            { neighborhood: 'São José', feeCents: 500 },
            { neighborhood: ' sao  jose ', feeCents: 700 }
          ]
        }),
      failsOn('zones')
    );

    throws(
      () =>
        validateDelivery({
          mode: DeliveryMode.ByZone,
          flatFeeCents: 0,
          zones: [{ neighborhood: 'Centro', feeCents: -1 }]
        }),
      failsOn('zones')
    );

    throws(
      () =>
        validateDelivery({
          mode: DeliveryMode.ByZone,
          flatFeeCents: 0,
          zones: [{ neighborhood: '   ', feeCents: 100 }]
        }),
      failsOn('zones')
    );

    deepEqual(
      validateDelivery({
        mode: DeliveryMode.ByZone,
        flatFeeCents: 0,
        zones: [{ neighborhood: ' Centro ', feeCents: 500 }]
      }),
      { mode: DeliveryMode.ByZone, flatFeeCents: 0, zones: [{ neighborhood: 'Centro', feeCents: 500 }] }
    );
  });

  it('checks the flat fee and clears zones in flat mode', () => {
    throws(() => validateDelivery({ mode: DeliveryMode.Flat, flatFeeCents: -1, zones: [] }), failsOn('flat_fee_cents'));
    throws(
      () => validateDelivery({ mode: DeliveryMode.Flat, flatFeeCents: 1.5, zones: [] }),
      failsOn('flat_fee_cents')
    );

    deepEqual(
      validateDelivery({
        mode: DeliveryMode.Flat,
        flatFeeCents: 800,
        zones: [{ neighborhood: 'Centro', feeCents: 500 }]
      }),
      { mode: DeliveryMode.Flat, flatFeeCents: 800, zones: [] }
    );
  });

  it('requires one payment method and drops repeats', () => {
    throws(() => validatePaymentMethods([]), failsOn('payment_methods'));
    deepEqual(validatePaymentMethods([PaymentMethod.Pix, PaymentMethod.Pix, PaymentMethod.Cash]), [
      PaymentMethod.Pix,
      PaymentMethod.Cash
    ]);
  });

  it('trims the store name and limits it to 80 characters', () => {
    equal(validateStoreName('  Pizzaria Boa  '), 'Pizzaria Boa');
    throws(() => validateStoreName('   '), failsOn('name'));
    throws(() => validateStoreName('x'.repeat(81)), failsOn('name'));
  });
});
