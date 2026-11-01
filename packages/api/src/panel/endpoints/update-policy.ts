import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity, PanelPolicy } from '../types';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validatePanelPolicy } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';
import { toPanelPolicy } from '../types';

export declare class UpdatePolicyRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: Partial<PanelPolicy>;
}

export declare class UpdatePolicyResponse implements Http.Response {
  status: 200;
  body: {
    policy: PanelPolicy;
  };
}

const toSnakeCase = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/**
 * Merges the sent keys into the policy; `null` clears a limit. Keys not sent stay as they are.
 */
export async function updatePolicyHandler(
  request: Http.Incoming<UpdatePolicyRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePolicyResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);

  const patch = await withSettingsErrors(() =>
    validatePanelPolicy(
      Object.fromEntries(Object.entries(request.body).map(([key, value]) => [toSnakeCase(key), value]))
    )
  );

  const policy = await StoreRepository.updatePolicy(db, store.id, patch);

  return { status: 200, body: { policy: toPanelPolicy(policy) } };
}
