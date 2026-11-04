import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AdminStoreProvider } from '../provider';
import type { AdminIdentity, AdminStoreDetail } from '../types';

import { isDemoEnabled } from '../../demo/enabled';
import { loadAdminDetail } from '../detail';

export declare class GetStoreRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
}

export declare class GetStoreResponse implements Http.Response {
  status: 200;
  body: AdminStoreDetail & {
    /**
     * The demo phones (`DEMO_ENABLED`) are on.
     */
    demoEnabled: boolean;
  };
}

export async function getStoreHandler(
  request: Http.Incoming<GetStoreRequest>,
  { db }: Service.Context<AdminStoreProvider>
): Promise<GetStoreResponse> {
  return {
    status: 200,
    body: { ...(await loadAdminDetail(db, request.parameters.storeId)), demoEnabled: isDemoEnabled() }
  };
}
