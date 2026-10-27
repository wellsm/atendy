import type { DbClient } from '../db';

import { randomBytes } from 'node:crypto';

import { HttpConflictError, HttpError } from '@ez4/gateway';

import { StoreRepository } from '../stores/repository';
import { EvolutionClient, EvolutionConnectionState, EvolutionRequestError } from '../whatsapp/evolution-client';

export const enum WhatsAppState {
  NotCreated = 'not_created',
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected'
}

export const enum StoreWhatsAppErrorCode {
  AlreadyConnected = 'already_connected',
  NotCreated = 'not_created'
}

export class StoreWhatsAppError extends Error {
  constructor(
    public readonly code: StoreWhatsAppErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type WhatsAppEnv = {
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  WEBHOOK_BASE_URL?: string;
};

const STATE_BY_EVOLUTION: Record<EvolutionConnectionState, WhatsAppState> = {
  [EvolutionConnectionState.Open]: WhatsAppState.Connected,
  [EvolutionConnectionState.Connecting]: WhatsAppState.Connecting,
  [EvolutionConnectionState.Close]: WhatsAppState.Disconnected
};

/**
 * Evolution management uses the global key: server-side only, never returned to the panel.
 */
export const evolutionAdmin = (env: WhatsAppEnv) => {
  const { EVOLUTION_API_URL, EVOLUTION_API_KEY, WEBHOOK_BASE_URL } = env;

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !WEBHOOK_BASE_URL) {
    throw new Error('Set EVOLUTION_API_URL, EVOLUTION_API_KEY and WEBHOOK_BASE_URL');
  }

  return { baseUrl: EVOLUTION_API_URL, apiKey: EVOLUTION_API_KEY, webhookBaseUrl: WEBHOOK_BASE_URL };
};

export const readState = async (admin: ReturnType<typeof evolutionAdmin>, instance: string | null) => {
  if (!instance) {
    return WhatsAppState.NotCreated;
  }

  try {
    return STATE_BY_EVOLUTION[await EvolutionClient.connectionState({ ...admin, instance })];
  } catch (error) {
    // The instance is in our database but not in Evolution (deleted or Evolution reset).
    if (error instanceof EvolutionRequestError && error.status === 404) {
      return WhatsAppState.NotCreated;
    }

    throw error;
  }
};

const requireInstance = async (db: DbClient, storeId: string) => {
  const record = await StoreRepository.getWhatsAppInstance(db, storeId);

  if (!record) {
    throw new Error(`Store ${storeId} not found`);
  }

  return record;
};

/**
 * The store's WhatsApp link through Evolution, shared by the panel and `admin:connect-whatsapp`.
 */
export namespace StoreWhatsApp {
  export const state = async (db: DbClient, storeId: string, env: WhatsAppEnv) => {
    const { instance } = await requireInstance(db, storeId);

    if (!instance) {
      return WhatsAppState.NotCreated;
    }

    return readState(evolutionAdmin(env), instance);
  };

  /**
   * Creates the instance when Evolution does not have it (new per-instance token, webhook with the store secret),
   * then asks for a QR code. A linked number is refused.
   */
  export const connect = async (db: DbClient, storeId: string, env: WhatsAppEnv) => {
    const admin = evolutionAdmin(env);
    const record = await requireInstance(db, storeId);
    const current = await readState(admin, record.instance);

    if (current === WhatsAppState.Connected) {
      throw new StoreWhatsAppError(StoreWhatsAppErrorCode.AlreadyConnected, 'WhatsApp is already connected');
    }

    const instance = record.instance ?? `atd_${storeId}`;
    const webhookUrl = `${admin.webhookBaseUrl}/webhooks/whatsapp/${storeId}`;

    if (current === WhatsAppState.NotCreated) {
      const token = randomBytes(32).toString('hex');

      await EvolutionClient.createInstance({
        baseUrl: admin.baseUrl,
        apiKey: admin.apiKey,
        instance,
        token,
        webhookUrl,
        webhookSecret: record.webhookSecret
      });

      await StoreRepository.setWhatsAppInstance(db, storeId, { instance, token });
    } else {
      await EvolutionClient.setWebhook({ ...admin, instance, webhookUrl, webhookSecret: record.webhookSecret });
    }

    const { qrBase64, pairingCode } = await EvolutionClient.connect({ ...admin, instance });

    return { qrBase64: qrBase64 ?? null, pairingCode: pairingCode ?? null };
  };

  /**
   * Unlinks the phone; the instance stays for the next QR.
   */
  export const disconnect = async (db: DbClient, storeId: string, env: WhatsAppEnv) => {
    const admin = evolutionAdmin(env);
    const { instance } = await requireInstance(db, storeId);

    if (!instance) {
      throw new StoreWhatsAppError(StoreWhatsAppErrorCode.NotCreated, 'WhatsApp was never connected');
    }

    await EvolutionClient.logout({ ...admin, instance });

    return readState(admin, instance);
  };
}

/**
 * Panel mapping: a state conflict is 409, an Evolution failure (error answer, unreachable, timeout) is 502.
 */
export const withEvolutionErrors = async <T>(action: () => Promise<T>) => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StoreWhatsAppError) {
      throw new HttpConflictError(error.message);
    }

    // An HTTP error from Evolution, or Evolution unreachable (`fetch` TypeError) / timed out (DOMException).
    if (error instanceof EvolutionRequestError || error instanceof TypeError || error instanceof DOMException) {
      throw new HttpError(502, 'WhatsApp service is unavailable');
    }

    throw error;
  }
};
