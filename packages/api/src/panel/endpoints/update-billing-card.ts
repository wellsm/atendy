import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { BillingSummary, CardHolderInput, CardInput } from '../../payments/types';
import type { PanelBillingProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';

import { asaasConfig, AsaasRequestError } from '../../payments/asaas-client';
import { PaymentsRepository } from '../../payments/repository';
import { PaymentError, validateCardForm } from '../../payments/validation';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';

export declare class UpdateBillingCardRequest implements Http.Request {
  identity: PanelIdentity;
  headers: {
    /**
     * Payer IP (Asaas anti-fraud): the first address the gateway saw.
     */
    'x-forwarded-for'?: string;
    'x-operator'?: string;
    'x-approval'?: string;
  };
  body: {
    holder: CardHolderInput;
    card: CardInput;
  };
}

export declare class UpdateBillingCardResponse implements Http.Response {
  status: 200;
  body: BillingSummary;
}

/**
 * Saves or swaps the store's card in Asaas (validated, no charge) and charges invoices already due. The card goes
 * straight to Asaas: never store or log the body.
 */
export async function updateBillingCardHandler(
  request: Http.Incoming<UpdateBillingCardRequest>,
  { db }: Service.Context<PanelBillingProvider>
): Promise<UpdateBillingCardResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const now = new Date();

  let form: ReturnType<typeof validateCardForm>;

  try {
    form = validateCardForm(request.body.holder, request.body.card, now);
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HttpBadRequestError(error.message, { field: error.field });
    }

    throw error;
  }

  // Local serve has no gateway in front: Asaas still needs some address.
  const remoteIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1';

  try {
    await PaymentsRepository.registerCard(db, asaasConfig(), { storeId: store.id, ...form, remoteIp, now });
  } catch (error) {
    if (error instanceof AsaasRequestError && error.refused) {
      throw new HttpBadRequestError('Card refused', { field: 'card' });
    }

    throw error;
  }

  const summary = await PaymentsRepository.summary(db, store.id);

  if (!summary) {
    throw new HttpNotFoundError('Store not found');
  }

  return { status: 200, body: summary };
}
