import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelCategory, PanelIdentity } from '../types';

import { MenuRepository } from '../../menu/repository';
import { requireStore, withMenuErrors } from '../store';

export declare class ReorderCategoriesRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    /**
     * Every category of the store, in the new order.
     */
    ids: String.UUID[];
  };
}

export declare class ReorderCategoriesResponse implements Http.Response {
  status: 200;
  body: {
    categories: PanelCategory[];
  };
}

export async function reorderCategoriesHandler(
  request: Http.Incoming<ReorderCategoriesRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<ReorderCategoriesResponse> {
  const store = await requireStore(db, request.identity);

  await withMenuErrors(() => MenuRepository.reorderCategories(db, store.id, request.body.ids));

  const menu = await MenuRepository.loadPanel(db, store.id);

  return { status: 200, body: { categories: menu.map(({ id, name }) => ({ id, name })) } };
}
