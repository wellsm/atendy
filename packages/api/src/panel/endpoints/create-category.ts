import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelCategory, PanelIdentity } from '../types';

import { MenuRepository } from '../../menu/repository';
import { validateCategoryName } from '../../menu/validation';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore, withMenuErrors } from '../store';

export declare class CreateCategoryRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    name: string;
  };
}

export declare class CreateCategoryResponse implements Http.Response {
  status: 201;
  body: {
    category: PanelCategory;
  };
}

/**
 * New category at the end of the menu.
 */
export async function createCategoryHandler(
  request: Http.Incoming<CreateCategoryRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<CreateCategoryResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);

  const category = await withMenuErrors(() =>
    MenuRepository.createCategory(db, store.id, validateCategoryName(request.body.name))
  );

  return { status: 201, body: { category } };
}
