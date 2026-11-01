import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';

export declare class DeleteProductRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
 * Hard delete: order items keep their own name, price and options snapshot. Groups other products still link stay.
 */
export async function deleteProductHandler(
  request: Http.Incoming<DeleteProductRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<DeleteProductResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { productId } = request.parameters;
  const imageKeys = await MenuRepository.deleteProduct(db, store.id, productId);

  if (!imageKeys) {
    throw new HttpNotFoundError('Product not found');
  }

  await Promise.all(imageKeys.map((key) => productImages.delete(key)));

  return { status: 200, body: { id: productId } };
}
