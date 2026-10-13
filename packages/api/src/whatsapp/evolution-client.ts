const REQUEST_TIMEOUT_MS = 15_000;

export const enum EvolutionConnectionState {
  Open = 'open',
  Connecting = 'connecting',
  Close = 'close'
}

export class EvolutionRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly permanent: boolean
  ) {
    super(message);
  }
}

const request = async (url: string, init: RequestInit) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;

    throw new EvolutionRequestError(`Evolution request failed (${response.status})`, response.status, permanent);
  }

  return body;
};

export namespace EvolutionClient {
  /**
   * Send a text with the instance token (never the global key). Evolution gives no delivery guarantee.
   */
  export const sendText = async (input: {
    baseUrl: string;
    instance: string;
    token: string;
    to: string;
    text: string;
  }) => {
    const body = await request(`${input.baseUrl}/message/sendText/${encodeURIComponent(input.instance)}`, {
      method: 'POST',
      headers: { apikey: input.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: input.to, text: input.text })
    });

    const key = body.key as { id?: unknown } | undefined;

    if (typeof key?.id !== 'string') {
      throw new EvolutionRequestError('Evolution response without key.id', 200, false);
    }

    return { providerMessageId: key.id };
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
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
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
