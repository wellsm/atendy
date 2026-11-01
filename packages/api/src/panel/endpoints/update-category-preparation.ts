import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { requireStore } from '../store';

export declare class UpdateCategoryPreparationRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    categoryId: String.UUID;
  };
  body: {
    needsPreparation: boolean;
  };
}

export declare class UpdateCategoryPreparationResponse implements Http.Response {
  status: 200;
  body: {
    needsPreparation: boolean;
  };
}

export async function updateCategoryPreparationHandler(
  request: Http.Incoming<UpdateCategoryPreparationRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateCategoryPreparationResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const { needsPreparation } = request.body;

  if (!(await MenuRepository.setCategoryPreparation(db, store.id, request.parameters.categoryId, needsPreparation))) {
    throw new HttpNotFoundError('Category not found');
  }

  return { status: 200, body: { needsPreparation } };
}
