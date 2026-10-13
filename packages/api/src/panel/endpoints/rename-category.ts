import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelCategory, PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { validateCategoryName } from '../../menu/validation';
import { requireStore, withMenuErrors } from '../store';

export declare class RenameCategoryRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    categoryId: String.UUID;
  };
  body: {
    name: string;
  };
}

export declare class RenameCategoryResponse implements Http.Response {
  status: 200;
  body: {
    category: PanelCategory;
  };
}

export async function renameCategoryHandler(
  request: Http.Incoming<RenameCategoryRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<RenameCategoryResponse> {
  const store = await requireStore(db, request.identity);
  const { categoryId } = request.parameters;
  const name = await withMenuErrors(() => validateCategoryName(request.body.name));

  if (!(await MenuRepository.renameCategory(db, store.id, categoryId, name))) {
    throw new HttpNotFoundError('Category not found');
  }

  return { status: 200, body: { category: { id: categoryId, name } } };
}
