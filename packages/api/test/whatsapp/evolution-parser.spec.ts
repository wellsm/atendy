import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEvolutionEvent } from '../../src/whatsapp/evolution-parser';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { evolutionTextEvent } from '../support/fixtures';

const asMessage = (body: unknown) => {
  const event = parseEvolutionEvent(body);

  if (event.kind !== ParsedEventKind.Message) {
    throw new Error(`expected message, got ignored: ${event.reason}`);
  }

  return event;
};

describe('parseEvolutionEvent', () => {
  it('reads a plain text message', () => {
    const event = asMessage(evolutionTextEvent({ text: 'quero uma pizza' }));

    equal(event.instance, 'atd_store');
    equal(event.providerMessageId, '3EB0A1B2C3D4E5F6');
    equal(event.fromMe, false);
    equal(event.jid, '5511999998888@s.whatsapp.net');
    equal(event.phone, '5511999998888');
    equal(event.pushName, 'Maria');
    equal(event.text, 'quero uma pizza');
    equal(event.sentAt, '2026-10-09T21:20:00.000Z');
  });

  it('reads extended text and image captions', () => {
    equal(asMessage(evolutionTextEvent({ message: { extendedTextMessage: { text: 'com link' } } })).text, 'com link');
    equal(asMessage(evolutionTextEvent({ message: { imageMessage: { caption: 'essa aqui' } } })).text, 'essa aqui');
  });

  it('keeps unsupported media as a bracketed marker so the turn can answer it', () => {
    equal(asMessage(evolutionTextEvent({ message: { audioMessage: { seconds: 4 } } })).text, '[audioMessage]');
  });

  it('prefers the phone JID when the contact is addressed by @lid', () => {
    const event = asMessage(
      evolutionTextEvent({ remoteJid: '123456789012345@lid', remoteJidAlt: '5511977776666@s.whatsapp.net' })
    );

    equal(event.jid, '123456789012345@lid');
    equal(event.phone, '5511977776666');
  });

  it('falls back to the @lid digits when no phone JID is present', () => {
    equal(asMessage(evolutionTextEvent({ remoteJid: '123456789012345@lid' })).phone, '123456789012345');
  });

  it('flags messages sent from the store phone', () => {
    equal(asMessage(evolutionTextEvent({ fromMe: true })).fromMe, true);
  });

  it('ignores groups, status broadcasts, other events and malformed bodies', () => {
    equal(
      parseEvolutionEvent(evolutionTextEvent({ remoteJid: '120363000000000000@g.us' })).kind,
      ParsedEventKind.Ignored
    );
    equal(parseEvolutionEvent(evolutionTextEvent({ remoteJid: 'status@broadcast' })).kind, ParsedEventKind.Ignored);
    equal(parseEvolutionEvent({ event: 'connection.update', data: { state: 'open' } }).kind, ParsedEventKind.Ignored);
    equal(parseEvolutionEvent({ event: 'messages.upsert', data: {} }).kind, ParsedEventKind.Ignored);
    equal(parseEvolutionEvent(null).kind, ParsedEventKind.Ignored);
  });
});
