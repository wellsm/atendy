import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity, PanelProduct } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { withImageUrl } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';

export declare class SetProductActiveRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<SetProductActiveResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuAvailability);
  const { productId } = request.parameters;

  const product =
    (await MenuRepository.setProductActive(db, store.id, productId, request.body.active)) &&
    (await MenuRepository.getProduct(db, store.id, productId));

  if (!product) {
    throw new HttpNotFoundError('Product not found');
  }

  return { status: 200, body: { product: await withImageUrl(productImages, product) } };
}
