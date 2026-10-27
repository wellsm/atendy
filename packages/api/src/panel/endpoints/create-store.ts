import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelOnboardingProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';

import { notifyAdmin } from '../../admin/telegram';
import { DEFAULT_LLM_MODEL, StoreRepository } from '../../stores/repository';
import { slugify } from '../slug';
import { toPanelStore } from '../types';

export declare class CreateStoreRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    name: String.Size<2, 80>;
    /**
     * The owner accepted the unofficial-WhatsApp risk notice.
     */
    acceptRisk: boolean;
  };
}

export declare class CreateStoreResponse implements Http.Response {
  status: 201;
  body: {
    store: PanelStore;
  };
}

/**
 * Onboarding: creates the store of the active Clerk org, inactive until the admin activates it.
 */
export async function createStoreHandler(
  request: Http.Incoming<CreateStoreRequest>,
  { db }: Service.Context<PanelOnboardingProvider>
): Promise<CreateStoreResponse> {
  const { orgId } = request.identity;
  const { acceptRisk } = request.body;
  const name = request.body.name.trim();

  if (!orgId) {
    throw new HttpBadRequestError('Create an organization first.');
  }

  // The schema checks the raw length; spaces alone must not make a valid name.
  if (name.length < 2) {
    throw new HttpBadRequestError('The store name needs at least 2 characters.');
  }

  if (acceptRisk !== true) {
    throw new HttpBadRequestError('The WhatsApp risk notice must be accepted.');
  }

  if (await StoreRepository.findByOrgId(db, orgId)) {
    throw new HttpConflictError('This organization already has a store.');
  }

  try {
    await StoreRepository.create(db, {
      name,
      slug: slugify(name),
      llmModel: DEFAULT_LLM_MODEL,
      active: false,
      clerkOrgId: orgId,
      riskAcceptedAt: new Date().toISOString()
    });
  } catch (error) {
    // Concurrent sign-up for the same org: the unique index on `clerk_org_id` rejected the second insert.
    if (await StoreRepository.findByOrgId(db, orgId)) {
      throw new HttpConflictError('This organization already has a store.');
    }

    throw error;
  }

  const store = await StoreRepository.findByOrgId(db, orgId);

  if (!store) {
    throw new Error(`Store of org ${orgId} not found after insert.`);
  }

  await notifyAdmin(`Nova loja aguardando ativação: ${store.name} (${store.slug}) ${store.id}`);

  // A new store has no hours yet: closed until the owner sets them.
  return { status: 201, body: { store: toPanelStore(store, false) } };
}
