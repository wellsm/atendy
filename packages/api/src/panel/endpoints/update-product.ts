import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelProduct, PanelProductInput } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

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
 * Replaces the whole product in one transaction. Groups and options sent with an id keep it.
 */
export async function updateProductHandler(
  request: Http.Incoming<UpdateProductRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<UpdateProductResponse> {
  const store = await requireStore(db, request.identity);

  const product = await withMenuErrors(() =>
    MenuRepository.replaceProduct(db, store.id, request.parameters.productId, validateProduct(request.body))
  );

  if (!product) {
    throw new HttpNotFoundError('Product not found');
  }

  return { status: 200, body: { product } };
}
