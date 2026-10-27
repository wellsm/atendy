import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGreeting, firstName, greetingPeriod, isGreetingOnly } from '../../src/conversations/greeting';

describe('greeting', () => {
  it('picks the period by the store timezone', () => {
    // 12:30 UTC is 09:30 in São Paulo and 13:30 in Lisbon (summer time).
    const now = new Date('2026-07-10T12:30:00.000Z');

    equal(greetingPeriod('America/Sao_Paulo', now), 'Bom dia');
    equal(greetingPeriod('Europe/Lisbon', now), 'Boa tarde');
    equal(greetingPeriod('America/Sao_Paulo', new Date('2026-07-10T23:00:00.000Z')), 'Boa noite');
    equal(greetingPeriod('America/Sao_Paulo', new Date('2026-07-10T06:00:00.000Z')), 'Boa noite');
  });

  it('uses the first word of the WhatsApp name only when it is a name', () => {
    equal(firstName('Wellington Martins'), 'Wellington');
    equal(firstName('*Ana*'), 'Ana');
    equal(firstName('🍕🍕'), undefined);
    equal(firstName(null), undefined);
  });

  it('tells a plain hello from a request', () => {
    equal(isGreetingOnly(['Olá']), true);
    equal(isGreetingOnly(['Oi, boa noite!', 'tudo bem?']), true);
    equal(isGreetingOnly(['oi', 'quero uma pizza']), false);
    equal(isGreetingOnly(['🖼️ Imagem']), false);
    equal(isGreetingOnly(['👍']), false);
  });

  it('welcomes a new customer in three messages with the menu link', () => {
    const messages = buildGreeting({
      period: 'Boa noite',
      name: 'Wellington',
      storeName: 'Pizzaria Bella',
      menuUrl: 'http://web.test/bella',
      newCustomer: true,
      standalone: true
    });

    equal(messages.length, 3);
    equal(messages[0], 'Boa noite, Wellington! 👋');
    equal(messages[1]!.includes('*Pizzaria Bella*'), true);
    equal(messages[2]!.includes('http://web.test/bella'), true);
    equal(messages[2]!.includes('é só pedir'), true);
  });

  it('sends one message before the model reply otherwise', () => {
    const base = { period: 'Bom dia', storeName: 'Bella*', menuUrl: 'http://web.test/bella' };

    deepEqual(buildGreeting({ ...base, newCustomer: true, standalone: false }), [
      'Bom dia! 👋 Sou o atendente virtual da loja *Bella* 🤖\nSe quiser falar com um atendente, é só pedir.'
    ]);
    deepEqual(buildGreeting({ ...base, name: 'Ana', newCustomer: false, standalone: false }), [
      'Bom dia, Ana! 👋 Que bom te ver de novo por aqui.\nSou o atendente virtual da loja *Bella* 🤖 Se quiser falar com um atendente, é só pedir.'
    ]);
  });
});
