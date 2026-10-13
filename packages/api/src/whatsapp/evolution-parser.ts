import type { ParsedEvent } from './types';

import { ParsedEventKind } from './types';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

const asString = (value: unknown) => (typeof value === 'string' && value.length ? value : undefined);

const ignored = (reason: string): ParsedEvent => ({ kind: ParsedEventKind.Ignored, reason });

const digitsOf = (jid: string) => jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';

const extractText = (message: Json) => {
  const extended = isObject(message.extendedTextMessage) ? message.extendedTextMessage : {};
  const image = isObject(message.imageMessage) ? message.imageMessage : {};
  const video = isObject(message.videoMessage) ? message.videoMessage : {};

  const text =
    asString(message.conversation) ?? asString(extended.text) ?? asString(image.caption) ?? asString(video.caption);

  if (text) {
    return text;
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

  const text = extractText(data.message);

  if (!text) {
    return ignored('empty message');
  }

  const phoneJid = [remoteJid, asString(key.remoteJidAlt), asString(key.senderPn)].find((jid) =>
    jid?.endsWith('@s.whatsapp.net')
  );

  const timestamp = Number(data.messageTimestamp);

  return {
    kind: ParsedEventKind.Message,
    instance,
    providerMessageId,
    fromMe: key.fromMe === true,
    jid: remoteJid,
    phone: digitsOf(phoneJid ?? remoteJid),
    pushName: asString(data.pushName),
    text,
    sentAt: new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now()).toISOString()
  };
};
