import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelProduct, PanelProductInput } from '../types';

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
 * Product with its groups and options, saved in one transaction.
 */
export async function createProductHandler(
  request: Http.Incoming<CreateProductRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<CreateProductResponse> {
  const store = await requireStore(db, request.identity);

  const product = await withMenuErrors(() => MenuRepository.createProduct(db, store.id, validateProduct(request.body)));

  return { status: 201, body: { product } };
}
