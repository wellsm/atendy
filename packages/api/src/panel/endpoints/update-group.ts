import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelMenuProvider } from '../provider';
import type { PanelGroup, PanelGroupContentInput, PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { signImage } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { validateGroupContent } from '../../menu/validation';
import { requireStore, withMenuErrors } from '../store';

export declare class UpdateMenuGroupRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    groupId: String.UUID;
  };
  body: PanelGroupContentInput;
}

export declare class UpdateMenuGroupResponse implements Http.Response {
  status: 200;
  body: {
    /**
     * `min`/`max` are the defaults for the next product linked.
     */
    group: PanelGroup;
  };
}

/**
 * Edits a group's name, price mode and options for every product linked to it. Options sent with an id keep it.
 */
export async function updateMenuGroupHandler(
  request: Http.Incoming<UpdateMenuGroupRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<UpdateMenuGroupResponse> {
  const store = await requireStore(db, request.identity);

  const saved = await withMenuErrors(() =>
    MenuRepository.updateGroup(db, store.id, request.parameters.groupId, validateGroupContent(request.body))
  );

  if (!saved) {
    throw new HttpNotFoundError('Group not found');
  }

  const { group, droppedImageKeys } = saved;

  await Promise.all(droppedImageKeys.map((key) => productImages.delete(key)));

  const options = await Promise.all(
    group.options.map(async ({ imageKey, ...option }) => ({
      ...option,
      imageUrl: await signImage(productImages, imageKey)
    }))
  );

  return { status: 200, body: { group: { ...group, options } } };
}
