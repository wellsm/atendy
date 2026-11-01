import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ImageTarget } from '../../menu/images';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { isBucketImage } from '../../menu/images';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { setImageKey } from '../images';
import { requireStore } from '../store';

export declare class DeleteImageRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    target: ImageTarget;
    id: String.UUID;
  };
}

export declare class DeleteImageResponse implements Http.Response {
  status: 200;
  body: {
    imageUrl: null;
  };
}

/**
 * Removes the product or option photo and its object.
 */
export async function deleteImageHandler(
  request: Http.Incoming<DeleteImageRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<DeleteImageResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { target, id } = request.parameters;
  const saved = await setImageKey(db, store.id, target, id, null);

  if (!saved) {
    throw new HttpNotFoundError('Not found');
  }

  if (isBucketImage(saved.previousKey)) {
    await productImages.delete(saved.previousKey);
  }

  return { status: 200, body: { imageUrl: null } };
}
