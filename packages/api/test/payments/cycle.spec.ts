import { deepEqual, equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstChargeDate, isPastGrace, localToday, previousCycle } from '../../src/payments/cycle';
import { PaymentError, validateCardForm } from '../../src/payments/validation';

describe('billing cycle dates (UTC−3)', () => {
  it('closes the previous calendar month in Brazil and charges on day 5', () => {
    // 00:30 in Brazil on Nov 1st is still 03:30 UTC.
    deepEqual(previousCycle(new Date('2026-11-01T03:30:00Z')), {
      periodStart: '2026-10-01T03:00:00.000Z',
      periodEnd: '2026-11-01T03:00:00.000Z',
      dueDate: '2026-11-05'
    });

    // 23:00 in Brazil on Oct 31st is already Nov 1st in UTC: still October's cycle running.
    equal(previousCycle(new Date('2026-11-01T02:00:00Z')).periodEnd, '2026-10-01T03:00:00.000Z');

    // January closes December of the year before.
    equal(previousCycle(new Date('2027-01-10T12:00:00Z')).periodStart, '2026-12-01T03:00:00.000Z');
  });

  it('starts a new subscription on the next charge day and rolls the year over', () => {
    equal(firstChargeDate(new Date('2026-10-16T12:00:00Z')), '2026-11-05');
    equal(firstChargeDate(new Date('2026-12-20T12:00:00Z')), '2027-01-05');
  });

  it('blocks only after the grace days', () => {
    equal(localToday(new Date('2026-11-13T02:00:00Z')), '2026-11-12');
    equal(isPastGrace('2026-11-05', new Date('2026-11-12T15:00:00Z')), false);
    equal(isPastGrace('2026-11-05', new Date('2026-11-13T15:00:00Z')), true);
  });
});

describe('validateCardForm', () => {
  const holder = {
    name: 'Maria Souza',
    cpfCnpj: '123.456.789-09',
    email: 'maria@example.com',
    phone: '(11) 98888-7777',
    postalCode: '01310-100',
    addressNumber: '100'
  };

  const card = {
    holderName: 'MARIA SOUZA',
    number: '4111 1111 1111 1111',
    expiryMonth: '5',
    expiryYear: '30',
    ccv: '123'
  };
  const now = new Date('2026-10-16T12:00:00Z');

  it('normalises digits and the expiry year', () => {
    const form = validateCardForm(holder, card, now);

    equal(form.holder.cpfCnpj, '12345678909');
    equal(form.holder.phone, '11988887777');
    equal(form.card.number, '4111111111111111');
    equal(form.card.expiryMonth, '05');
    equal(form.card.expiryYear, '2030');
  });

  it('names the field to fix', () => {
    const field = (input: Parameters<typeof validateCardForm>) => {
      try {
        validateCardForm(...input);
      } catch (error) {
        return error instanceof PaymentError ? error.field : 'other';
      }

      return null;
    };

    equal(field([{ ...holder, cpfCnpj: '123' }, card, now]), 'holder.cpf_cnpj');
    equal(field([holder, { ...card, number: '4111111111111112' }, now]), 'card.number');
    equal(field([holder, { ...card, expiryMonth: '09', expiryYear: '2026' }, now]), 'card.expiry');
    equal(field([holder, { ...card, ccv: '1' }, now]), 'card.ccv');
    throws(() => validateCardForm({ ...holder, email: 'x' }, card, now), PaymentError);
  });
});
