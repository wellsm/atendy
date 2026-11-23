import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity, PanelStore } from '../types';

import { HttpBadRequestError } from '@ez4/gateway';

import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { openOverrideUntil } from '../../stores/open';
import { StoreRepository } from '../../stores/repository';
import { validateStoreName } from '../../stores/settings';
import { loadPanelStore, requireStore, withSettingsErrors } from '../store';

export declare class UpdateStoreRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    name?: string;
    /**
     * Manual Aberto (`true`) / Fechado (`false`) until the hours next change; `null` goes back to the hours.
     */
    open?: boolean | null;
  };
}

export declare class UpdateStoreResponse implements Http.Response {
  status: 200;
  body: {
    store: PanelStore;
  };
}

/**
 * Store name and the Aberto/Fechado control.
 */
export async function updateStoreHandler(
  request: Http.Incoming<UpdateStoreRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdateStoreResponse> {
  const store = await requireStore(db, request.identity);
  const { name, open } = request.body;

  // Opening or closing alone is a board action; the name stays a setting.
  await authorize(
    db,
    store,
    request.identity,
    request.headers,
    name === undefined ? Permission.OrdersBoard : Permission.Settings
  );

  if (name === undefined && open === undefined) {
    throw new HttpBadRequestError('Nothing to update.');
  }

  const validName = await withSettingsErrors(() => (name === undefined ? undefined : validateStoreName(name)));

  const openOverride =
    open === undefined
      ? undefined
      : {
          open,
          until:
            open === null ? null : openOverrideUntil(open, await StoreRepository.getHours(db, store.id), store.timezone)
        };

  await StoreRepository.updateStore(db, store.id, { name: validName, openOverride });

  return {
    status: 200,
    body: {
      store: await loadPanelStore(db, {
        ...store,
        ...(validName !== undefined && { name: validName }),
        ...(openOverride && {
          accepting_orders: true,
          open_override: openOverride.open,
          open_override_until: openOverride.until
        })
      })
    }
  };
}
