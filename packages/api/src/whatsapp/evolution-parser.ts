import type { ParsedEvent } from './types';

import { formatLocationBody } from './location';
import { formatMediaBody, MediaKind } from './media';
import { ParsedEventKind } from './types';

type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

export const asString = (value: unknown) => (typeof value === 'string' && value.length ? value : undefined);

const ignored = (reason: string): ParsedEvent => ({ kind: ParsedEventKind.Ignored, reason });

export const digitsOf = (jid: string) => jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';

/**
 * The phone-number JID of a message key: `remoteJid` itself, or the alternate Evolution sends when it is an `@lid`.
 */
export const phoneJidOf = (key: Json) =>
  [asString(key.remoteJid), asString(key.remoteJidAlt), asString(key.senderPn)].find((jid) =>
    jid?.endsWith('@s.whatsapp.net')
  );

/**
 * WhatsApp message keys of the media the panel and the bot recognise.
 */
const MEDIA_KEYS: [string, MediaKind][] = [
  ['imageMessage', MediaKind.Image],
  ['videoMessage', MediaKind.Video],
  ['ptvMessage', MediaKind.Video],
  ['audioMessage', MediaKind.Audio],
  ['documentMessage', MediaKind.Document],
  ['stickerMessage', MediaKind.Sticker]
];

const extractMedia = (message: Json): string | undefined => {
  // A document with a caption arrives wrapped in its own message.
  const wrapped = isObject(message.documentWithCaptionMessage) ? message.documentWithCaptionMessage.message : undefined;

  if (isObject(wrapped)) {
    return extractMedia(wrapped);
  }

  for (const [key, kind] of MEDIA_KEYS) {
    const media = message[key];

    if (isObject(media)) {
      return formatMediaBody(kind, asString(media.caption)?.trim() || undefined);
    }
  }

  return undefined;
};

const extractText = (message: Json) => {
  const extended = isObject(message.extendedTextMessage) ? message.extendedTextMessage : {};
  const text = asString(message.conversation) ?? asString(extended.text);

  if (text) {
    return text;
  }

  const media = extractMedia(message);

  if (media) {
    return media;
  }

  const location = isObject(message.locationMessage) ? message.locationMessage : undefined;

  if (location && typeof location.degreesLatitude === 'number' && typeof location.degreesLongitude === 'number') {
    return formatLocationBody({ latitude: location.degreesLatitude, longitude: location.degreesLongitude });
  }

  const type = Object.keys(message).find((key) => key.endsWith('Message'));

  return type ? `[${type}]` : undefined;
};

/**
 * Parse an Evolution API v2 webhook body. Only one-to-one `messages.upsert` events are kept.
 */
export const parseEvolutionEvent = (body: unknown): ParsedEvent => {
  if (!isObject(body) || body.event !== 'messages.upsert' || !isObject(body.data)) {
    return ignored('not a message event');
  }

  const { data } = body;
  const key = isObject(data.key) ? data.key : {};

  const remoteJid = asString(key.remoteJid);
  const providerMessageId = asString(key.id);
  const instance = asString(body.instance);

  if (!remoteJid || !providerMessageId || !instance || !isObject(data.message)) {
    return ignored('incomplete message');
  }

  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return ignored('group or broadcast');
  }

  const phoneJid = phoneJidOf(key);

  const timestamp = Number(data.messageTimestamp);

  const base = {
    instance,
    providerMessageId,
    fromMe: key.fromMe === true,
    jid: remoteJid,
    phone: digitsOf(phoneJid ?? remoteJid),
    pushName: asString(data.pushName),
    sentAt: new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now()).toISOString()
  };

  const reaction = isObject(data.message.reactionMessage) ? data.message.reactionMessage : undefined;

  if (reaction) {
    const reactedId = isObject(reaction.key) ? asString(reaction.key.id) : undefined;

    if (!reactedId) {
      return ignored('reaction without target');
    }

    return { kind: ParsedEventKind.Reaction, ...base, reactedId, emoji: asString(reaction.text) ?? '' };
  }

  const text = extractText(data.message);

  if (!text) {
    return ignored('empty message');
  }

  const voiceNote = isObject(data.message.audioMessage) ? { key, message: data.message } : undefined;

  return { kind: ParsedEventKind.Message, ...base, text, ...(voiceNote && { voiceNote }) };
};
