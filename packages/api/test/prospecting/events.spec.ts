import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseProspectingEvent, ProspectingEventKind } from '../../src/prospecting/events';
import { ProspectStatus } from '../../src/prospecting/types';

const upsert = (key: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event: 'messages.upsert',
  instance: 'atd_prospecting_a1b2c3d4',
  data: {
    key: { id: 'M1', fromMe: false, ...key },
    messageTimestamp: 1761000000,
    message: { conversation: 'oi' },
    ...extra
  }
});

const update = (data: Record<string, unknown>) => ({
  event: 'messages.update',
  instance: 'atd_prospecting_a1b2c3d4',
  data
});

const connection = (state: string) => ({
  event: 'connection.update',
  instance: 'atd_prospecting_a1b2c3d4',
  data: { instance: 'atd_prospecting_a1b2c3d4', state, statusReason: 200 }
});

describe('parseProspectingEvent', () => {
  it('reads a lead reply as inbound with the phone and timestamp', () => {
    deepEqual(parseProspectingEvent(upsert({ remoteJid: '5511987654321@s.whatsapp.net' })), {
      kind: ProspectingEventKind.Inbound,
      instance: 'atd_prospecting_a1b2c3d4',
      phone: '5511987654321',
      at: new Date(1761000000 * 1000)
    });
  });

  it('resolves an @lid reply through the alternate phone JID', () => {
    const event = parseProspectingEvent(
      upsert({ remoteJid: '1234567890@lid', remoteJidAlt: '551187654321@s.whatsapp.net' })
    );

    deepEqual(event.kind === ProspectingEventKind.Inbound && event.phone, '551187654321');
  });

  it('ignores an @lid reply without a phone alternate', () => {
    deepEqual(parseProspectingEvent(upsert({ remoteJid: '1234567890@lid' })), { kind: ProspectingEventKind.Ignored });
  });

  it('ignores own messages, groups and status broadcasts', () => {
    const ignored = { kind: ProspectingEventKind.Ignored };

    deepEqual(parseProspectingEvent(upsert({ remoteJid: '5511987654321@s.whatsapp.net', fromMe: true })), ignored);
    deepEqual(parseProspectingEvent(upsert({ remoteJid: '120363@g.us' })), ignored);
    deepEqual(parseProspectingEvent(upsert({ remoteJid: 'status@broadcast' })), ignored);
  });

  it('maps message statuses to delivered and read', () => {
    const ack = (status: string, data: Record<string, unknown> = { keyId: 'M1' }) =>
      parseProspectingEvent(update({ ...data, status }));

    deepEqual(ack('DELIVERY_ACK'), {
      kind: ProspectingEventKind.Ack,
      instance: 'atd_prospecting_a1b2c3d4',
      providerMessageId: 'M1',
      status: ProspectStatus.Delivered
    });

    deepEqual(ack('READ', { keyId: 'M1' }).kind, ProspectingEventKind.Ack);
    deepEqual(ack('PLAYED', { keyId: 'M1' }).kind, ProspectingEventKind.Ack);
    deepEqual(ack('SERVER_ACK'), { kind: ProspectingEventKind.Ignored });
    deepEqual(ack('DELIVERY_ACK', { key: { id: 'M2' } }), {
      kind: ProspectingEventKind.Ack,
      instance: 'atd_prospecting_a1b2c3d4',
      providerMessageId: 'M2',
      status: ProspectStatus.Delivered
    });
    deepEqual(ack('DELIVERY_ACK', { messageId: 'M3' }).kind, ProspectingEventKind.Ack);
    deepEqual(ack('DELIVERY_ACK', {}), { kind: ProspectingEventKind.Ignored });
  });

  it('maps connection states', () => {
    const open = (state: string) => {
      const event = parseProspectingEvent(connection(state));

      return event.kind === ProspectingEventKind.Connection ? event.open : 'ignored';
    };

    deepEqual(open('close'), false);
    deepEqual(open('open'), true);
    deepEqual(open('connecting'), null);
    deepEqual(open('refused'), 'ignored');
  });

  it('ignores anything else', () => {
    deepEqual(parseProspectingEvent(null), { kind: ProspectingEventKind.Ignored });
    deepEqual(parseProspectingEvent({ event: 'qrcode.updated', instance: 'x', data: {} }), {
      kind: ProspectingEventKind.Ignored
    });
  });
});
