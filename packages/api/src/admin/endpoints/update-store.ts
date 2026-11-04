import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type { RouterType } from '../../stores/types';
import type { OrderCodeMode, StoreRedirect, StoreType } from '../../stores/types';
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
    /**
     * Menu (food) or catalog (retail) wording for the bot and the public page.
     */
    storeType?: StoreType;
    /**
     * Last message of the welcome a new customer gets for a plain hello; `null` = the catalog link.
     */
    welcomeText?: string | null;
    /**
     * One service the store handles elsewhere (the bot sends the link; billed at 10 %); `null` removes it.
     */
    redirect?: StoreRedirect | null;
    /**
     * The store never sells: fixed welcome with the link, then catalog questions and handoff. Needs `redirect`.
     */
    redirectOnly?: boolean;
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
  const {
    active,
    router,
    llmModel,
    orderMemoryHours,
    orderPriceCents,
    webOrderPercent,
    orderCodeMode,
    storeType,
    welcomeText,
    redirect,
    redirectOnly
  } = request.body;

  if (
    [
      active,
      router,
      llmModel,
      orderMemoryHours,
      orderPriceCents,
      webOrderPercent,
      orderCodeMode,
      storeType,
      welcomeText,
      redirect,
      redirectOnly
    ].every((value) => value === undefined)
  ) {
    throw new HttpBadRequestError('Nothing to update.');
  }

  if (llmModel !== undefined && !isLlmModel(llmModel)) {
    throw new HttpBadRequestError('Unknown model.', { field: 'llm_model' });
  }

  const policy = {
    ...(orderMemoryHours !== undefined && parsePolicyKey('order_memory_hours', orderMemoryHours)),
    ...(welcomeText !== undefined && parsePolicyKey('welcome_text', welcomeText)),
    ...(redirect !== undefined && parsePolicyKey('redirect', redirect)),
    ...(redirectOnly !== undefined && parsePolicyKey('redirect_only', redirectOnly))
  };

  await requireAdminStore(db, storeId);

  if (redirect !== undefined || redirectOnly !== undefined) {
    const merged = { ...(await StoreRepository.getPolicy(db, storeId)), ...policy };

    if (merged.redirect_only && !merged.redirect) {
      throw new HttpBadRequestError('A redirect store needs a redirect link.', { field: 'redirect_only' });
    }
  }

  if (active !== undefined) {
    await StoreRepository.setActive(db, storeId, active);
  }

  if (router !== undefined) {
    await StoreRepository.setRouter(db, storeId, router);
  }

  if (llmModel !== undefined) {
    await StoreRepository.setLlmModel(db, storeId, llmModel);
  }

  if (Object.keys(policy).length) {
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

  if (storeType !== undefined) {
    await StoreRepository.setStoreType(db, storeId, storeType);
  }

  return { status: 200, body: await loadAdminDetail(db, storeId) };
}

/**
 * Same rule as `admin:set-policy`.
 */
const parsePolicyKey = (key: string, value: unknown) => {
  try {
    return parsePolicyPatch(JSON.stringify({ [key]: value }));
  } catch (error) {
    if (error instanceof PolicyError) {
      throw new HttpBadRequestError(error.message, { field: key });
    }

    throw error;
  }
};
