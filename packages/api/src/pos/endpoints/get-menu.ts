import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelMenuProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosMenuCategory } from '../types';

import { withImageUrls } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../../panel/store';

export declare class GetPosMenuRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetPosMenuResponse implements Http.Response {
  status: 200;
  body: {
    categories: PosMenuCategory[];
  };
}

/**
 * The menu as the public storefront maps it (active products, sold-out flags, signed photos) plus the kitchen flags.
 */
export async function getPosMenuHandler(
  request: Http.Incoming<GetPosMenuRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<GetPosMenuResponse> {
  const store = await requireStore(db, request.identity);

  const menu = (await MenuRepository.loadPanel(db, store.id))
    .map(({ id, name, needsPreparation, products }) => ({
      id,
      name,
      needsPreparation,
      products: products
        .filter(({ active }) => active)
        .map(({ id, name, description, priceCents, soldOut, imageKey, groups, needsPreparation }) => ({
          id,
          name,
          description,
          priceCents,
          soldOut,
          imageKey,
          groups,
          needsPreparation
        }))
    }))
    .filter(({ products }) => products.length);

  const categories = await withImageUrls(productImages, menu);

  return {
    status: 200,
    body: {
      categories: categories.map((category, index) => ({
        ...category,
        needsPreparation: menu[index]!.needsPreparation
      }))
    }
  };
}
