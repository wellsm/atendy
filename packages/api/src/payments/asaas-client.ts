import type { CardHolderInput, CardInput } from './types';

/**
 * Asaas asks for at least 60 s: a shorter timeout can abort a charge that went through, and a retry duplicates it.
 */
const REQUEST_TIMEOUT_MS = 60_000;

export type AsaasConfig = {
  /**
   * `https://api-sandbox.asaas.com/v3` (dev) or `https://api.asaas.com/v3` (prd).
   */
  apiUrl: string;
  apiKey: string;
};

export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl: string | null;
};

export class AsaasRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /**
     * Asaas error code (e.g. `invalid_creditCard`); never shown to the store as is.
     */
    public readonly code: string | null
  ) {
    super(message);
  }

  /**
   * The card or its holder data was refused (a 400 from Asaas), not an outage.
   */
  get refused() {
    return this.status === 400;
  }
}

const reais = (cents: number) => Math.round(cents) / 100;

const request = async (config: AsaasConfig, method: string, path: string, body?: unknown) => {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      access_token: config.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'atendy'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const [error] = (data.errors as { code?: string; description?: string }[] | undefined) ?? [];

    throw new AsaasRequestError(
      `Asaas request failed (${response.status})${error?.description ? `: ${error.description}` : ''}`,
      response.status,
      error?.code ?? null
    );
  }

  return data;
};

const toPayment = (data: Record<string, unknown>): AsaasPayment => ({
  id: String(data.id),
  status: String(data.status ?? ''),
  value: Number(data.value ?? 0),
  dueDate: String(data.dueDate ?? ''),
  invoiceUrl: typeof data.invoiceUrl === 'string' ? data.invoiceUrl : null
});

const cardBody = (holder: CardHolderInput, card: CardInput, remoteIp: string) => ({
  creditCard: {
    holderName: card.holderName,
    number: card.number,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    ccv: card.ccv
  },
  creditCardHolderInfo: {
    name: holder.name,
    email: holder.email,
    cpfCnpj: holder.cpfCnpj,
    postalCode: holder.postalCode,
    addressNumber: holder.addressNumber,
    phone: holder.phone
  },
  remoteIp
});

/**
 * Card brand and last 4 digits from an Asaas response; the number itself never comes back.
 */
const cardSummary = (data: Record<string, unknown>, number: string) => {
  const card = data.creditCard as { creditCardBrand?: unknown; creditCardNumber?: unknown } | undefined;

  return {
    brand: typeof card?.creditCardBrand === 'string' ? card.creditCardBrand : 'CARD',
    last4: typeof card?.creditCardNumber === 'string' ? card.creditCardNumber.slice(-4) : number.slice(-4)
  };
};

export namespace AsaasClient {
  export const createCustomer = async (
    config: AsaasConfig,
    input: { holder: CardHolderInput; externalReference: string }
  ) => {
    const data = await request(config, 'POST', '/customers', {
      name: input.holder.name,
      cpfCnpj: input.holder.cpfCnpj,
      email: input.holder.email,
      mobilePhone: input.holder.phone,
      postalCode: input.holder.postalCode,
      addressNumber: input.holder.addressNumber,
      externalReference: input.externalReference,
      notificationDisabled: true
    });

    return { id: String(data.id) };
  };

  /**
   * Monthly card subscription: Asaas validates the card now (no charge) and charges it on each due date. `valueCents`
   * is a placeholder; each cycle's payment gets its real amount at close.
   */
  export const createSubscription = async (
    config: AsaasConfig,
    input: {
      customerId: string;
      valueCents: number;
      nextDueDate: string;
      description: string;
      externalReference: string;
      holder: CardHolderInput;
      card: CardInput;
      remoteIp: string;
    }
  ) => {
    const data = await request(config, 'POST', '/subscriptions', {
      customer: input.customerId,
      billingType: 'CREDIT_CARD',
      cycle: 'MONTHLY',
      value: reais(input.valueCents),
      nextDueDate: input.nextDueDate,
      description: input.description,
      externalReference: input.externalReference,
      ...cardBody(input.holder, input.card, input.remoteIp)
    });

    return { id: String(data.id), ...cardSummary(data, input.card.number) };
  };

  /**
   * Swaps the subscription's card (validated, no charge).
   */
  export const updateSubscriptionCard = async (
    config: AsaasConfig,
    input: { subscriptionId: string; holder: CardHolderInput; card: CardInput; remoteIp: string }
  ) => {
    const data = await request(
      config,
      'PUT',
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}/creditCard`,
      cardBody(input.holder, input.card, input.remoteIp)
    );

    return cardSummary(data, input.card.number);
  };

  export const listSubscriptionPayments = async (config: AsaasConfig, subscriptionId: string) => {
    const data = await request(
      config,
      'GET',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?status=PENDING&limit=10`
    );

    return ((data.data as Record<string, unknown>[] | undefined) ?? []).map(toPayment);
  };

  export const updatePayment = async (
    config: AsaasConfig,
    input: { paymentId: string; valueCents: number; dueDate: string; description: string }
  ) => {
    const data = await request(config, 'PUT', `/payments/${encodeURIComponent(input.paymentId)}`, {
      billingType: 'CREDIT_CARD',
      value: reais(input.valueCents),
      dueDate: input.dueDate,
      description: input.description
    });

    return toPayment(data);
  };

  export const deletePayment = async (config: AsaasConfig, paymentId: string) => {
    await request(config, 'DELETE', `/payments/${encodeURIComponent(paymentId)}`);
  };

  export const getPayment = async (config: AsaasConfig, paymentId: string) =>
    toPayment(await request(config, 'GET', `/payments/${encodeURIComponent(paymentId)}`));

  /**
   * One-off charge on the card, processed now (an invoice closed without a card on file).
   */
  export const chargeCard = async (
    config: AsaasConfig,
    input: {
      customerId: string;
      valueCents: number;
      dueDate: string;
      description: string;
      externalReference: string;
      holder: CardHolderInput;
      card: CardInput;
      remoteIp: string;
    }
  ) => {
    const data = await request(config, 'POST', '/payments', {
      customer: input.customerId,
      billingType: 'CREDIT_CARD',
      value: reais(input.valueCents),
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
      ...cardBody(input.holder, input.card, input.remoteIp)
    });

    return toPayment(data);
  };

  /**
   * Charges an existing (refused) payment again with a new card.
   */
  export const payWithCard = async (
    config: AsaasConfig,
    input: { paymentId: string; holder: CardHolderInput; card: CardInput; remoteIp: string }
  ) => {
    const data = await request(
      config,
      'POST',
      `/payments/${encodeURIComponent(input.paymentId)}/payWithCreditCard`,
      cardBody(input.holder, input.card, input.remoteIp)
    );

    return toPayment(data);
  };
}

/**
 * Asaas config from the stage variables; throws when the API is not configured (refuse instead of skipping a charge).
 */
export const asaasConfig = (env: Record<string, string | undefined> = process.env): AsaasConfig => {
  const { ASAAS_API_URL, ASAAS_API_KEY } = env;

  if (!ASAAS_API_URL || !ASAAS_API_KEY) {
    throw new Error('Asaas is not configured');
  }

  return { apiUrl: ASAAS_API_URL.replace(/\/$/, ''), apiKey: ASAAS_API_KEY };
};
