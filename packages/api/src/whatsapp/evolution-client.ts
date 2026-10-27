const REQUEST_TIMEOUT_MS = 15_000;

export const enum EvolutionConnectionState {
  Open = 'open',
  Connecting = 'connecting',
  Close = 'close'
}

export type EvolutionWebhookEvent = 'MESSAGES_UPSERT' | 'MESSAGES_UPDATE' | 'CONNECTION_UPDATE';

const DEFAULT_EVENTS: EvolutionWebhookEvent[] = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

export class EvolutionRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly permanent: boolean,
    /**
     * The send was refused because the number has no WhatsApp.
     */
    public readonly notOnWhatsApp = false
  ) {
    super(message);
  }
}

/**
 * Evolution's 400 for a number without WhatsApp: `{ response: { message: [{ jid, exists: false, number }] } }`.
 */
const isNotOnWhatsApp = (status: number, body: Record<string, unknown>) => {
  const message = (body?.response as { message?: unknown } | undefined)?.message;

  return (
    status === 400 &&
    Array.isArray(message) &&
    message.some((item) => (item as { exists?: unknown } | null)?.exists === false)
  );
};

const request = async (url: string, init: RequestInit) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;

    throw new EvolutionRequestError(
      `Evolution request failed (${response.status})`,
      response.status,
      permanent,
      isNotOnWhatsApp(response.status, body)
    );
  }

  return body;
};

/**
 * WhatsApp drops "composing" after about 25 s on its own.
 */
const TYPING_MS = 25_000;

export namespace EvolutionClient {
  /**
   * "Digitando…" for the customer. Evolution holds the request open for `delay`, then sends "paused"; the caller
   * aborts it once the reply is ready (the reply itself clears the indicator).
   */
  export const sendTyping = async (input: {
    baseUrl: string;
    instance: string;
    token: string;
    to: string;
    signal: AbortSignal;
  }) => {
    await fetch(`${input.baseUrl}/chat/sendPresence/${encodeURIComponent(input.instance)}`, {
      method: 'POST',
      headers: { apikey: input.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: input.to, presence: 'composing', delay: TYPING_MS }),
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(TYPING_MS + REQUEST_TIMEOUT_MS)])
    });
  };

  /**
   * Send a text with the instance token (never the global key). Evolution gives no delivery guarantee.
   */
  export const sendText = async (input: {
    baseUrl: string;
    instance: string;
    token: string;
    to: string;
    text: string;
    /**
     * Evolution shows "digitando…" for this long, then sends (the request waits).
     */
    delayMs?: number;
  }) => {
    const body = await request(`${input.baseUrl}/message/sendText/${encodeURIComponent(input.instance)}`, {
      method: 'POST',
      headers: { apikey: input.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: input.to, text: input.text, ...(input.delayMs && { delay: input.delayMs }) })
    });

    const key = body.key as { id?: unknown } | undefined;

    if (typeof key?.id !== 'string') {
      throw new EvolutionRequestError('Evolution response without key.id', 200, false);
    }

    return { providerMessageId: key.id };
  };

  /**
   * Downloads a received media message. The whole `{ key, message }` goes along, so Evolution fetches it from WhatsApp
   * without needing its own message store.
   */
  export const getMediaBase64 = async (input: {
    baseUrl: string;
    instance: string;
    token: string;
    message: Record<string, unknown>;
  }) => {
    const body = await request(
      `${input.baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(input.instance)}`,
      {
        method: 'POST',
        headers: { apikey: input.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.message, convertToMp4: false })
      }
    );

    if (typeof body.base64 !== 'string' || !body.base64) {
      throw new EvolutionRequestError('Evolution response without base64', 200, false);
    }

    return { base64: body.base64, mimetype: typeof body.mimetype === 'string' ? body.mimetype : '' };
  };

  /**
   * Create an instance with its per-store webhook. Deletes an orphan with the same name first
   * (a timed-out create can leave one behind).
   */
  export const createInstance = async (input: {
    baseUrl: string;
    apiKey: string;
    instance: string;
    token: string;
    webhookUrl: string;
    webhookSecret: string;
    events?: EvolutionWebhookEvent[];
  }) => {
    const headers = { apikey: input.apiKey, 'Content-Type': 'application/json' };

    await request(`${input.baseUrl}/instance/delete/${encodeURIComponent(input.instance)}`, {
      method: 'DELETE',
      headers
    }).catch(() => undefined);

    await request(`${input.baseUrl}/instance/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        instanceName: input.instance,
        token: input.token,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          url: input.webhookUrl,
          byEvents: false,
          base64: false,
          headers: { authorization: input.webhookSecret },
          events: input.events ?? DEFAULT_EVENTS
        }
      })
    });
  };

  /**
   * Point an existing instance's webhook at the current API base URL (it changes with the stage/project name).
   */
  export const setWebhook = async (input: {
    baseUrl: string;
    apiKey: string;
    instance: string;
    webhookUrl: string;
    webhookSecret: string;
    events?: EvolutionWebhookEvent[];
  }) => {
    await request(`${input.baseUrl}/webhook/set/${encodeURIComponent(input.instance)}`, {
      method: 'POST',
      headers: { apikey: input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: input.webhookUrl,
          byEvents: false,
          base64: false,
          headers: { authorization: input.webhookSecret },
          events: input.events ?? DEFAULT_EVENTS
        }
      })
    });
  };

  export const connect = async (input: { baseUrl: string; apiKey: string; instance: string }) => {
    const body = await request(`${input.baseUrl}/instance/connect/${encodeURIComponent(input.instance)}`, {
      method: 'GET',
      headers: { apikey: input.apiKey }
    });

    const qrcode = (body.qrcode ?? {}) as Record<string, unknown>;

    const pick = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

    return {
      qrBase64: pick(qrcode.base64) ?? pick(body.base64),
      pairingCode: pick(qrcode.pairingCode) ?? pick(body.pairingCode)
    };
  };

  /**
   * `open` (linked), `connecting` (waiting for the QR scan) or `close`. A missing instance throws with status 404.
   */
  export const connectionState = async (input: {
    baseUrl: string;
    apiKey: string;
    instance: string;
  }): Promise<EvolutionConnectionState> => {
    const body = await request(`${input.baseUrl}/instance/connectionState/${encodeURIComponent(input.instance)}`, {
      method: 'GET',
      headers: { apikey: input.apiKey }
    });

    const state = (body.instance as { state?: unknown } | undefined)?.state;

    if (state === 'open') {
      return EvolutionConnectionState.Open;
    }

    return state === 'connecting' ? EvolutionConnectionState.Connecting : EvolutionConnectionState.Close;
  };

  /**
   * Unlinks the phone. The instance and its token stay, so a new QR is enough to reconnect.
   */
  export const logout = async (input: { baseUrl: string; apiKey: string; instance: string }) => {
    await request(`${input.baseUrl}/instance/logout/${encodeURIComponent(input.instance)}`, {
      method: 'DELETE',
      headers: { apikey: input.apiKey }
    });
  };
}
