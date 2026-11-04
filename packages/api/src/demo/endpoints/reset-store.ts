import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminStoreProvider } from '../../admin/provider';
import type { AdminIdentity } from '../../admin/types';

import { HttpBadRequestError } from '@ez4/gateway';

import { requireAdminStore } from '../../admin/detail';
import { assertDemoEnabled } from '../enabled';
import { resetDemoStore } from '../reset';

export declare class ResetDemoStoreRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
  body: {
    /**
     * The store's own slug, typed by the admin as confirmation.
     */
    slug: String.Size<1, 80>;
  };
}

export declare class ResetDemoStoreResponse implements Http.Response {
  status: 200;
  body: {
    conversations: number;
    orders: number;
    customers: number;
  };
}

/**
 * Wipes a store's conversations and what hangs on them before another demo. Only with `DEMO_ENABLED=true`.
 */
export async function resetAdminDemoStoreHandler(
  request: Http.Incoming<ResetDemoStoreRequest>,
  { db }: Service.Context<AdminStoreProvider>
): Promise<ResetDemoStoreResponse> {
  assertDemoEnabled();

  const { storeId } = request.parameters;
  const store = await requireAdminStore(db, storeId);

  if (request.body.slug.trim() !== store.slug) {
    throw new HttpBadRequestError('Type the store slug to confirm.', { field: 'slug' });
  }

  return { status: 200, body: await resetDemoStore(db, storeId) };
}
