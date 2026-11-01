import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelCategory, PanelIdentity } from '../types';

import { MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore, withMenuErrors } from '../store';

export declare class ReorderCategoriesRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
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
  { db }: Service.Context<PanelStaffProvider>
): Promise<ReorderCategoriesResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);

  await withMenuErrors(() => MenuRepository.reorderCategories(db, store.id, request.body.ids));

  const menu = await MenuRepository.loadPanel(db, store.id);

  return { status: 200, body: { categories: menu.map(({ id, name }) => ({ id, name })) } };
}
