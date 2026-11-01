import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';

import { DeleteCategoryResult, MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';

export declare class DeleteCategoryRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    categoryId: String.UUID;
  };
}

export declare class DeleteCategoryResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
  };
}

/**
 * Only an empty category: deleting one with products would silently delete them.
 */
export async function deleteCategoryHandler(
  request: Http.Incoming<DeleteCategoryRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<DeleteCategoryResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { categoryId } = request.parameters;

  const result = await MenuRepository.deleteCategory(db, store.id, categoryId);

  if (result === DeleteCategoryResult.NotFound) {
    throw new HttpNotFoundError('Category not found');
  }

  if (result === DeleteCategoryResult.NotEmpty) {
    throw new HttpConflictError('The category still has products.');
  }

  return { status: 200, body: { id: categoryId } };
}
