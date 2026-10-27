import type { DbClient } from '../db';
import type { WhatsAppEnv } from '../panel/whatsapp';

import { randomBytes } from 'node:crypto';

import { PROSPECTING_EVENTS } from './events';
import { ProspectingRepository } from './repository';
import {
  evolutionAdmin,
  readState,
  StoreWhatsAppError,
  StoreWhatsAppErrorCode,
  WhatsAppState
} from '../panel/whatsapp';
import { EvolutionClient } from '../whatsapp/evolution-client';

/**
 * The prospecting sender's WhatsApp link through Evolution: `StoreWhatsApp` on the single sender row.
 */
export namespace ProspectingWhatsApp {
  /**
   * Stores the state just read as `connected` (a missed `connection.update` would leave it stale); `paused` is left as
   * it is, so resuming stays manual.
   */
  const syncState = async (db: DbClient, state: WhatsAppState) => {
    await ProspectingRepository.setSenderState(db, { connected: state === WhatsAppState.Connected });

    return state;
  };

  export const state = async (db: DbClient, env: WhatsAppEnv) => {
    const { instance } = await ProspectingRepository.getSender(db);

    if (!instance) {
      return WhatsAppState.NotCreated;
    }

    return syncState(db, await readState(evolutionAdmin(env), instance));
  };

  /**
   * Creates the instance on the first connect (name `atd_prospecting_<8 hex>`, new token, webhook with the sender
   * secret), or re-sets its webhook, then asks for a QR code. A linked number is refused.
   */
  export const connect = async (db: DbClient, env: WhatsAppEnv) => {
    const admin = evolutionAdmin(env);
    const sender = await ProspectingRepository.getSender(db);
    const current = await readState(admin, sender.instance);

    if (current === WhatsAppState.Connected) {
      throw new StoreWhatsAppError(StoreWhatsAppErrorCode.AlreadyConnected, 'WhatsApp is already connected');
    }

    const instance = sender.instance ?? `atd_prospecting_${randomBytes(4).toString('hex')}`;
    const webhookUrl = `${admin.webhookBaseUrl}/webhooks/prospecting`;

    if (current === WhatsAppState.NotCreated) {
      const token = randomBytes(32).toString('hex');

      await EvolutionClient.createInstance({
        baseUrl: admin.baseUrl,
        apiKey: admin.apiKey,
        instance,
        token,
        webhookUrl,
        webhookSecret: sender.webhookSecret,
        events: PROSPECTING_EVENTS
      });

      await ProspectingRepository.setSenderState(db, { instance, token });
    } else {
      await EvolutionClient.setWebhook({
        ...admin,
        instance,
        webhookUrl,
        webhookSecret: sender.webhookSecret,
        events: PROSPECTING_EVENTS
      });
    }

    const { qrBase64, pairingCode } = await EvolutionClient.connect({ ...admin, instance });

    return { qrBase64: qrBase64 ?? null, pairingCode: pairingCode ?? null };
  };

  /**
   * Unlinks the phone; the instance stays for the next QR.
   */
  export const disconnect = async (db: DbClient, env: WhatsAppEnv) => {
    const admin = evolutionAdmin(env);
    const { instance } = await ProspectingRepository.getSender(db);

    if (!instance) {
      throw new StoreWhatsAppError(StoreWhatsAppErrorCode.NotCreated, 'WhatsApp was never connected');
    }

    await EvolutionClient.logout({ ...admin, instance });

    return syncState(db, await readState(admin, instance));
  };
}
