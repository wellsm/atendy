import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelIdentity, PanelProduct } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class SetProductActiveRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    productId: String.UUID;
  };
  body: {
    active: boolean;
  };
}

export declare class SetProductActiveResponse implements Http.Response {
  status: 200;
  body: {
    product: PanelProduct;
  };
}

export async function setProductActiveHandler(
  request: Http.Incoming<SetProductActiveRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<SetProductActiveResponse> {
  const store = await requireStore(db, request.identity);
  const { productId } = request.parameters;

  const product =
    (await MenuRepository.setProductActive(db, store.id, productId, request.body.active)) &&
    (await MenuRepository.getProduct(db, store.id, productId));

  if (!product) {
    throw new HttpNotFoundError('Product not found');
  }

  return { status: 200, body: { product } };
}
