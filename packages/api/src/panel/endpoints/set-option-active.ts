import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpNotFoundError } from '@ez4/gateway';

import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class SetOptionActiveRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    optionId: String.UUID;
  };
  body: {
    active: boolean;
  };
}

export declare class SetOptionActiveResponse implements Http.Response {
  status: 200;
  body: {
    option: {
      id: string;
      active: boolean;
    };
  };
}

/**
 * Sold out (or back) in one click, without opening the product.
 */
export async function setOptionActiveHandler(
  request: Http.Incoming<SetOptionActiveRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<SetOptionActiveResponse> {
  const store = await requireStore(db, request.identity);
  const { optionId } = request.parameters;
  const { active } = request.body;

  if (!(await MenuRepository.setOptionActive(db, store.id, optionId, active))) {
    throw new HttpNotFoundError('Option not found');
  }

  return { status: 200, body: { option: { id: optionId, active } } };
}
