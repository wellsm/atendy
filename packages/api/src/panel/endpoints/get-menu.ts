import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelMenuProvider } from '../provider';
import type { PanelIdentity, PanelMenuCategory } from '../types';

import { withImageUrls } from '../../menu/images';
import { MenuRepository } from '../../menu/repository';
import { requireStore } from '../store';

export declare class GetMenuRequest implements Http.Request {
  identity: PanelIdentity;
}

export declare class GetMenuResponse implements Http.Response {
  status: 200;
  body: {
    categories: PanelMenuCategory[];
  };
}

/**
 * Whole menu, inactive items included.
 */
export async function getMenuHandler(
  request: Http.Incoming<GetMenuRequest>,
  { db, productImages }: Service.Context<PanelMenuProvider>
): Promise<GetMenuResponse> {
  const store = await requireStore(db, request.identity);

  return {
    status: 200,
    body: { categories: await withImageUrls(productImages, await MenuRepository.loadPanel(db, store.id)) }
  };
}
