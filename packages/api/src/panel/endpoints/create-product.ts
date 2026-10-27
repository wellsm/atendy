import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity, PanelProduct, PanelProductInput } from '../types';

import { withImageUrl } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { validateProduct } from '../../menu/validation';
import { requireStore, withMenuErrors } from '../store';

export declare class CreateProductRequest implements Http.Request {
  identity: PanelIdentity;
  body: PanelProductInput;
}

export declare class CreateProductResponse implements Http.Response {
  status: 201;
  body: {
    product: PanelProduct;
  };
}

/**
 * Product with its groups and options, saved in one transaction. A sent group id links that group of the store.
 */
export async function createProductHandler(
  request: Http.Incoming<CreateProductRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<CreateProductResponse> {
  const store = await requireStore(db, request.identity);

  const { product, droppedImageKeys } = await withMenuErrors(() =>
    MenuRepository.createProduct(db, store.id, validateProduct(request.body))
  );

  // Options removed from a linked shared group take their photos with them.
  await Promise.all(droppedImageKeys.map((key) => productImages.delete(key)));

  return { status: 201, body: { product: await withImageUrl(productImages, product) } };
}
