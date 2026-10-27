import type { EvolutionWebhookEvent } from '../whatsapp/evolution-client';

import { ProspectStatus } from './types';
import { asString, digitsOf, isObject, phoneJidOf } from '../whatsapp/evolution-parser';

export const PROSPECTING_EVENTS: EvolutionWebhookEvent[] = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'];

export const enum ProspectingEventKind {
  Inbound = 'inbound',
  Ack = 'ack',
  Connection = 'connection',
  Ignored = 'ignored'
}

export type ProspectingEvent =
  | { kind: ProspectingEventKind.Inbound; instance: string; phone: string; at: Date }
  | {
      kind: ProspectingEventKind.Ack;
      instance: string;
      providerMessageId: string;
      status: ProspectStatus.Delivered | ProspectStatus.Read;
    }
  | { kind: ProspectingEventKind.Connection; instance: string; open: boolean | null }
  | { kind: ProspectingEventKind.Ignored };

const IGNORED: ProspectingEvent = { kind: ProspectingEventKind.Ignored };

const ACK_STATUS: Record<string, ProspectStatus.Delivered | ProspectStatus.Read> = {
  DELIVERY_ACK: ProspectStatus.Delivered,
  READ: ProspectStatus.Read,
  PLAYED: ProspectStatus.Read
};

const parseUpsert = (instance: string, data: Record<string, unknown>): ProspectingEvent => {
  const key = isObject(data.key) ? data.key : {};
  const remoteJid = asString(key.remoteJid);

  if (!remoteJid || key.fromMe === true || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return IGNORED;
  }

  const phoneJid = phoneJidOf(key);

  // An `@lid` without a phone-number alternate cannot be matched to a lead.
  if (!phoneJid) {
    return IGNORED;
  }

  const timestamp = Number(data.messageTimestamp);

  return {
    kind: ProspectingEventKind.Inbound,
    instance,
    phone: digitsOf(phoneJid),
    at: new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now())
  };
};

const parseUpdate = (instance: string, data: Record<string, unknown>): ProspectingEvent => {
  const key = isObject(data.key) ? data.key : {};
  const providerMessageId = asString(data.keyId) ?? asString(key.id) ?? asString(data.messageId);
  const status = ACK_STATUS[asString(data.status) ?? ''];

  if (!providerMessageId || !status) {
    return IGNORED;
  }

  return { kind: ProspectingEventKind.Ack, instance, providerMessageId, status };
};

const OPEN_BY_STATE: Record<string, boolean | null> = { open: true, close: false, connecting: null };

const parseConnection = (instance: string, data: Record<string, unknown>): ProspectingEvent => {
  const state = asString(data.state) ?? '';

  // "refused" and other states are not a connection change we act on.
  if (!(state in OPEN_BY_STATE)) {
    return IGNORED;
  }

  return { kind: ProspectingEventKind.Connection, instance, open: OPEN_BY_STATE[state] ?? null };
};

/**
 * Parse an Evolution v2 webhook body for the prospecting sender: customer replies (1:1 only), delivery/read acks and
 * connection changes. Reply content is never read.
 */
export const parseProspectingEvent = (body: unknown): ProspectingEvent => {
  if (!isObject(body) || !isObject(body.data)) {
    return IGNORED;
  }

  const instance = asString(body.instance);

  if (!instance) {
    return IGNORED;
  }

  switch (body.event) {
    case 'messages.upsert':
      return parseUpsert(instance, body.data);
    case 'messages.update':
      return parseUpdate(instance, body.data);
    case 'connection.update':
      return parseConnection(instance, body.data);
    default:
      return IGNORED;
  }
};
