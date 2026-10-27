import { deepEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseEvolutionEvent } from '../../src/whatsapp/evolution-parser';
import { ParsedEventKind } from '../../src/whatsapp/types';
import { evolutionTextEvent } from '../support/fixtures';

const asMessage = (body: unknown) => {
  const event = parseEvolutionEvent(body);

  if (event.kind !== ParsedEventKind.Message) {
    throw new Error(`expected message, got ${event.kind}`);
  }

  return event;
};

describe('parseEvolutionEvent', () => {
  it('reads a reaction and its removal as reaction events, never as text', () => {
    const reaction = (text: string) =>
      parseEvolutionEvent(
        evolutionTextEvent({
          id: 'R1',
          message: { reactionMessage: { key: { id: 'BOT-1', fromMe: true }, text, senderTimestampMs: '1' } }
        })
      );

    const added = reaction('👍');

    equal(added.kind, ParsedEventKind.Reaction);
    equal(added.kind === ParsedEventKind.Reaction && added.reactedId, 'BOT-1');
    equal(added.kind === ParsedEventKind.Reaction && added.emoji, '👍');
    equal(added.kind === ParsedEventKind.Reaction && added.providerMessageId, 'R1');

    const removed = reaction('');

    equal(removed.kind === ParsedEventKind.Reaction && removed.emoji, '');
    equal(
      parseEvolutionEvent(evolutionTextEvent({ message: { reactionMessage: { text: '👍' } } })).kind,
      ParsedEventKind.Ignored
    );
  });

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

  it('reads extended text', () => {
    equal(asMessage(evolutionTextEvent({ message: { extendedTextMessage: { text: 'com link' } } })).text, 'com link');
  });

  it('labels media by kind and keeps the caption', () => {
    const text = (message: Record<string, unknown>) => asMessage(evolutionTextEvent({ message })).text;

    equal(text({ imageMessage: { caption: 'essa aqui' } }), '🖼️ Imagem: essa aqui');
    equal(text({ imageMessage: {} }), '🖼️ Imagem');
    equal(text({ videoMessage: { caption: ' ' } }), '🎥 Vídeo');
    equal(text({ audioMessage: { seconds: 4, ptt: true } }), '🎤 Áudio');
    equal(text({ stickerMessage: {} }), '💬 Figurinha');
    equal(
      text({
        documentWithCaptionMessage: { message: { documentMessage: { caption: 'cardápio', fileName: 'a.pdf' } } }
      }),
      '📄 Documento: cardápio'
    );
  });

  it('keeps the raw voice note to download it later, and nothing for other messages', () => {
    const event = evolutionTextEvent({ message: { audioMessage: { seconds: 4, ptt: true, mediaKey: 'k' } } });

    deepEqual(asMessage(event).voiceNote, { key: event.data.key, message: event.data.message });
    equal(asMessage(evolutionTextEvent({ text: 'oi' })).voiceNote, undefined);
    equal(asMessage(evolutionTextEvent({ message: { imageMessage: {} } })).voiceNote, undefined);
  });

  it('turns a shared location into the canonical location body', () => {
    const event = asMessage(
      evolutionTextEvent({
        message: { locationMessage: { degreesLatitude: -23.5505199, degreesLongitude: -46.6333081, name: 'Casa' } }
      })
    );

    equal(event.text, '📍 Localização: -23.550520,-46.633308');
  });

  it('keeps other message kinds as a bracketed marker so the turn can answer it', () => {
    equal(
      asMessage(evolutionTextEvent({ message: { contactMessage: { displayName: 'Ana' } } })).text,
      '[contactMessage]'
    );
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
