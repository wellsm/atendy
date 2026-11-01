import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ImageTarget } from '../../menu/images';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { imageKey, isBucketImage, signImage, stagingKey } from '../../menu/images';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { imageOwnerExists, publishUpload, setImageKey } from '../images';
import { requireStore } from '../store';

export declare class CompleteImageRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    target: ImageTarget;
    id: String.UUID;
  };
}

export declare class CompleteImageResponse implements Http.Response {
  status: 200;
  body: {
    imageUrl: string | null;
  };
}

/**
 * Checks the staged upload and publishes it as the product or option photo, replacing the previous one.
 */
export async function completeImageHandler(
  request: Http.Incoming<CompleteImageRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<CompleteImageResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { target, id } = request.parameters;

  if (!(await imageOwnerExists(db, store.id, target, id))) {
    throw new HttpNotFoundError('Not found');
  }

  const key = imageKey(store.id, target, id);

  await publishUpload(productImages, stagingKey(store.id, target, id), key);

  const saved = await setImageKey(db, store.id, target, id, key);

  if (!saved) {
    await productImages.delete(key);

    throw new HttpNotFoundError('Not found');
  }

  if (isBucketImage(saved.previousKey)) {
    await productImages.delete(saved.previousKey);
  }

  return { status: 200, body: { imageUrl: await signImage(productImages, key) } };
}
