import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class DeleteProductRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    productId: String.UUID;
  };
}

export declare class DeleteProductResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Hard delete: order items keep their own name, price and options snapshot.
 */
export async function deleteProductHandler(
  request: Http.Incoming<DeleteProductRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<DeleteProductResponse> {
  const store = await requireStore(db, request.identity);
  const { productId } = request.parameters;

  if (!(await MenuRepository.deleteProduct(db, store.id, productId))) {
    throw new HttpNotFoundError('Product not found');
  }

  return { status: 200, body: { id: productId } };
}
