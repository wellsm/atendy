import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class UpdateCategoryPreparationRequest implements Http.Request {
  identity: PanelIdentity;
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
  { db }: Service.Context<PanelProvider>
): Promise<UpdateCategoryPreparationResponse> {
  const store = await requireStore(db, request.identity);
  const { needsPreparation } = request.body;

  if (!(await MenuRepository.setCategoryPreparation(db, store.id, request.parameters.categoryId, needsPreparation))) {
    throw new HttpNotFoundError('Category not found');
  }

  return { status: 200, body: { needsPreparation } };
}
