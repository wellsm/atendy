import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminClerkProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';

import { ClerkBackend } from '../../clerk/backend';
import { slugify } from '../../panel/slug';
import { DEFAULT_LLM_MODEL, StoreRepository } from '../../stores/repository';

/**
 * Static web routes a store slug would shadow (`/<slug>` is the public menu).
 */
const RESERVED_SLUGS = ['panel', 'admin', 'onboarding', 'courier', 'sign-in'];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

export declare class CreateAdminStoreRequest implements Http.Request {
  identity: AdminIdentity;
  body: {
    name: String.Size<1, 80>;
    /**
     * Defaults to the name plus 4 random chars.
     */
    slug?: string;
  };
}

export declare class CreateAdminStoreResponse implements Http.Response {
  status: 201;
  body: {
    store: { id: string; name: string; slug: string };
  };
}

/**
 * Creates a store already active, with its own Clerk org (no members yet: add users in `/admin/users`).
 */
export async function createAdminStoreHandler(
  request: Http.Incoming<CreateAdminStoreRequest>,
  { db }: Service.Context<AdminClerkProvider>
): Promise<CreateAdminStoreResponse> {
  const name = request.body.name.trim();
  const slug = request.body.slug?.trim().toLowerCase() || slugify(name);

  if (!name) {
    throw new HttpBadRequestError('Name is required.', { field: 'name' });
  }

  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.includes(slug)) {
    throw new HttpBadRequestError('Invalid or reserved slug.', { field: 'slug' });
  }

  if (await StoreRepository.findBySlug(db, slug)) {
    throw new HttpConflictError('Slug already used.', { field: 'slug' });
  }

  const orgId = await ClerkBackend.createOrg(name);

  try {
    await StoreRepository.create(db, { name, slug, llmModel: DEFAULT_LLM_MODEL, active: true, clerkOrgId: orgId });
  } catch (error) {
    await ClerkBackend.deleteOrg(orgId);

    // A concurrent create took the slug between the check and the insert.
    if (await StoreRepository.findBySlug(db, slug)) {
      throw new HttpConflictError('Slug already used.', { field: 'slug' });
    }

    throw error;
  }

  const store = await StoreRepository.findByOrgId(db, orgId);

  if (!store) {
    throw new Error(`Store of org ${orgId} not found after insert.`);
  }

  return { status: 201, body: { store: { id: store.id, name: store.name, slug: store.slug } } };
}
