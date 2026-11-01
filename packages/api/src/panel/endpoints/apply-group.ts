import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Array, String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore, withMenuErrors } from '../store';

export declare class ApplyMenuGroupRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    groupId: String.UUID;
  };
  body: {
    productIds: Array.Size<String.UUID, 1, 200>;
    /**
     * "Choose from `min` to `max`" for the products linked now.
     */
    min: number;
    max: number;
  };
}

export declare class ApplyMenuGroupResponse implements Http.Response {
  status: 200;
  body: {
    applied: string[];
    /**
     * Products already linked to the group or with another group of the same name.
     */
    alreadyHad: string[];
    /**
     * Products at the group limit.
     */
    full: string[];
  };
}

/**
 * Links a group to many products at once; its name, price mode and options stay shared.
 */
export async function applyMenuGroupHandler(
  request: Http.Incoming<ApplyMenuGroupRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<ApplyMenuGroupResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);

  const { productIds, min, max } = request.body;

  const result = await withMenuErrors(() =>
    MenuRepository.applyGroup(db, store.id, request.parameters.groupId, productIds, { min, max })
  );

  if (!result) {
    throw new HttpNotFoundError('Group not found');
  }

  return { status: 200, body: result };
}
