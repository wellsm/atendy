import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity, PanelProduct, PanelProductInput } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { withImageUrl } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { validateProduct } from '../../menu/validation';
import { requireStore, withMenuErrors } from '../store';

export declare class UpdateProductRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    productId: String.UUID;
  };
  body: PanelProductInput;
}

export declare class UpdateProductResponse implements Http.Response {
  status: 200;
  body: {
    product: PanelProduct;
  };
}

/**
 * Replaces the whole product in one transaction. Groups and options sent with an id keep it; a group of another product
 * becomes shared with this one.
 */
export async function updateProductHandler(
  request: Http.Incoming<UpdateProductRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<UpdateProductResponse> {
  const store = await requireStore(db, request.identity);
  const { productId } = request.parameters;

  const saved = await withMenuErrors(() =>
    MenuRepository.replaceProduct(db, store.id, productId, validateProduct(request.body))
  );

  if (!saved) {
    throw new HttpNotFoundError('Product not found');
  }

  const { product, droppedImageKeys } = saved;

  // Options deleted by this save take their photos with them (unlinking a shared group deletes none).
  await Promise.all(droppedImageKeys.map((key) => productImages.delete(key)));

  return { status: 200, body: { product: await withImageUrl(productImages, product) } };
}
