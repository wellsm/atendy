import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ImageTarget, ImageType } from '../../menu/images';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { stagingKey, UPLOAD_SECONDS } from '../../menu/images';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { imageOwnerExists } from '../images';
import { requireStore } from '../store';

export declare class StartImageRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    target: ImageTarget;
    id: String.UUID;
  };
  body: {
    contentType: ImageType;
  };
}

export declare class StartImageResponse implements Http.Response {
  status: 200;
  body: {
    /**
     * PUT the file here with the same `content-type`, then call `POST .../image` to publish it.
     */
    uploadUrl: string;
  };
}

/**
 * Signed upload URL for a product or option photo (lands in staging; nothing is published yet).
 */
export async function startImageHandler(
  request: Http.Incoming<StartImageRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<StartImageResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { target, id } = request.parameters;

  if (!(await imageOwnerExists(db, store.id, target, id))) {
    throw new HttpNotFoundError('Not found');
  }

  const uploadUrl = await productImages.getWriteUrl(stagingKey(store.id, target, id), {
    expiresIn: UPLOAD_SECONDS,
    contentType: request.body.contentType
  });

  return { status: 200, body: { uploadUrl } };
}
