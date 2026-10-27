import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { RouterType } from '../../stores/types';
import type { OrderCodeMode } from '../../stores/types';
import type { AdminProvider } from '../provider';
import type { AdminIdentity, AdminStoreDetail } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { isLlmModel } from '../../stores/models';
import { parsePolicyPatch, PolicyError } from '../../stores/policy';
import { StoreRepository } from '../../stores/repository';
import { loadAdminDetail, requireAdminStore } from '../detail';

export declare class UpdateStoreRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
  body: {
    active?: boolean;
    router?: RouterType;
    llmModel?: string;
    /**
     * `null` clears it (default 3 h).
     */
    orderMemoryHours?: number | null;
    /**
     * Price per order in cents (up to R$ 1.000); `null` goes back to the default.
     */
    orderPriceCents?: Integer.Range<0, 100000> | null;
    /**
     * Percent of the order price billed for a web order; `null` goes back to the default.
     */
    webOrderPercent?: Integer.Range<0, 100> | null;
    /**
     * Order codes: 6 random symbols or 1, 2, 3…
     */
    orderCodeMode?: OrderCodeMode;
  };
}

export declare class UpdateStoreResponse implements Http.Response {
  status: 200;
  body: AdminStoreDetail;
}

/**
 * Technical settings of any store: activation (an inactive store gets no WhatsApp processing), router, model and
 * order memory.
 */
export async function updateAdminStoreHandler(
  request: Http.Incoming<UpdateStoreRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<UpdateStoreResponse> {
  const { storeId } = request.parameters;
  const { active, router, llmModel, orderMemoryHours, orderPriceCents, webOrderPercent, orderCodeMode } = request.body;

  if (
    [active, router, llmModel, orderMemoryHours, orderPriceCents, webOrderPercent, orderCodeMode].every(
      (value) => value === undefined
    )
  ) {
    throw new HttpBadRequestError('Nothing to update.');
  }

  if (llmModel !== undefined && !isLlmModel(llmModel)) {
    throw new HttpBadRequestError('Unknown model.', { field: 'llm_model' });
  }

  const policy = orderMemoryHours === undefined ? undefined : parseOrderMemory(orderMemoryHours);

  await requireAdminStore(db, storeId);

  if (active !== undefined) {
    await StoreRepository.setActive(db, storeId, active);
  }

  if (router !== undefined) {
    await StoreRepository.setRouter(db, storeId, router);
  }

  if (llmModel !== undefined) {
    await StoreRepository.setLlmModel(db, storeId, llmModel);
  }

  if (policy) {
    await StoreRepository.updatePolicy(db, storeId, policy);
  }

  if (orderPriceCents !== undefined) {
    await StoreRepository.setOrderPrice(db, storeId, orderPriceCents);
  }

  if (webOrderPercent !== undefined) {
    await StoreRepository.setWebOrderPercent(db, storeId, webOrderPercent);
  }

  if (orderCodeMode !== undefined) {
    await StoreRepository.setOrderCodeMode(db, storeId, orderCodeMode);
  }

  return { status: 200, body: await loadAdminDetail(db, storeId) };
}

/**
 * Same rule as `admin:set-policy`.
 */
const parseOrderMemory = (hours: number | null) => {
  try {
    return parsePolicyPatch(JSON.stringify({ order_memory_hours: hours }));
  } catch (error) {
    if (error instanceof PolicyError) {
      throw new HttpBadRequestError(error.message, { field: 'order_memory_hours' });
    }

    throw error;
  }
};
