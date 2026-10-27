import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { DemoMenuKind } from '../../menu/demo-menus';
import type { AdminProvider } from '../provider';
import type { AdminIdentity } from '../types';

import { HttpConflictError } from '@ez4/gateway';

import { countProducts, DEMO_MENUS } from '../../menu/demo-menus';
import { MenuRepository } from '../../menu/repository';
import { requireAdminStore } from '../detail';

export declare class SeedDemoMenuRequest implements Http.Request {
  identity: AdminIdentity;
  parameters: {
    storeId: String.UUID;
  };
  body: {
    kind: DemoMenuKind;
    /**
     * Deletes the current menu first. Past orders keep their item snapshots.
     */
    replace?: boolean;
  };
}

export declare class SeedDemoMenuResponse implements Http.Response {
  status: 200;
  body: {
    products: number;
  };
}

/**
 * Demo menu of a business type. Without `replace`, only for a store with no product at all (active or not).
 * Hours stay as the store set them.
 */
export async function seedDemoMenuHandler(
  request: Http.Incoming<SeedDemoMenuRequest>,
  { db }: Service.Context<AdminProvider>
): Promise<SeedDemoMenuResponse> {
  const { storeId } = request.parameters;
  const { kind, replace } = request.body;
  const menu = DEMO_MENUS[kind];

  await requireAdminStore(db, storeId);

  if (replace) {
    await MenuRepository.replaceMenu(db, storeId, menu);

    return { status: 200, body: { products: countProducts(menu) } };
  }

  if (await db.products.count({ where: { store_id: storeId } })) {
    throw new HttpConflictError('The store already has a menu.');
  }

  await MenuRepository.importMenu(db, storeId, menu);

  return { status: 200, body: { products: countProducts(menu) } };
}
