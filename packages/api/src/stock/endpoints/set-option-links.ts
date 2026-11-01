import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { OperatorHeaders } from '../../staff/authorize';
import type { StockUnit } from '../types';

import { requireStore } from '../../panel/store';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { withStockErrors } from '../errors';
import { StockRepository } from '../repository';

export declare class SetOptionStockLinksRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  parameters: {
    optionId: String.UUID;
  };
  body: {
    links: {
      stockItemId: String.UUID;
      qty: number;
    }[];
  };
}

export declare class SetOptionStockLinksResponse implements Http.Response {
  status: 200;
  body: {
    links: {
      stockItemId: string;
      name: string;
      unit: StockUnit;
      qty: number;
    }[];
  };
}

/**
 * Replaces the stock the option consumes per unit sold; returns the saved links.
 */
export async function setOptionStockLinksHandler(
  request: Http.Incoming<SetOptionStockLinksRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<SetOptionStockLinksResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.MenuEdit);
  const target = { optionId: request.parameters.optionId };

  const links = await withStockErrors(async () => {
    await StockRepository.setLinks(db, store.id, target, request.body.links);

    return StockRepository.linksFor(db, store.id, target);
  });

  return { status: 200, body: { links } };
}
