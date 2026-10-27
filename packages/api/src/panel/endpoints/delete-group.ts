import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class DeleteMenuGroupRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    groupId: String.UUID;
  };
}

export declare class DeleteMenuGroupResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Removes a group from every product and deletes it. Order items keep their options snapshot.
 */
export async function deleteMenuGroupHandler(
  request: Http.Incoming<DeleteMenuGroupRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<DeleteMenuGroupResponse> {
  const store = await requireStore(db, request.identity);
  const { groupId } = request.parameters;
  const imageKeys = await MenuRepository.deleteGroup(db, store.id, groupId);

  if (!imageKeys) {
    throw new HttpNotFoundError('Group not found');
  }

  await Promise.all(imageKeys.map((key) => productImages.delete(key)));

  return { status: 200, body: { id: groupId } };
}
