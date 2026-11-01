import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Integer } from '@ez4/schema';
import type { OperatorHeaders } from '../../staff/authorize';
import type { PosSettings } from '../../stores/types';
import type { PanelStaffProvider } from '../provider';
import type { PanelIdentity } from '../types';

import { HttpConflictError } from '@ez4/gateway';

import { CashRepository } from '../../cash/repository';
import { authorize } from '../../staff/authorize';
import { Permission } from '../../staff/permissions';
import { StoreRepository } from '../../stores/repository';
import { validatePosSettings } from '../../stores/settings';
import { requireStore, withSettingsErrors } from '../store';

export declare class UpdatePosSettingsRequest implements Http.Request {
  identity: PanelIdentity;
  headers: OperatorHeaders;
  body: {
    layout: string;
    cashControl: boolean;
    blindClose: boolean;
    receiptWidth: Integer.Range<58, 80>;
  };
}

export declare class UpdatePosSettingsResponse implements Http.Response {
  status: 200;
  body: PosSettings;
}

/**
 * Counter POS defaults: layout, cash control, blind close and receipt width.
 */
export async function updatePosSettingsHandler(
  request: Http.Incoming<UpdatePosSettingsRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UpdatePosSettingsResponse> {
  const store = await requireStore(db, request.identity);
  await authorize(db, store, request.identity, request.headers, Permission.Settings);
  const settings = await withSettingsErrors(() => validatePosSettings(request.body));

  if (!settings.cashControl && (await CashRepository.currentSession(db, store.id))) {
    throw new HttpConflictError('Close the cash session before turning cash control off.', {
      field: 'pos_cash_control'
    });
  }

  await StoreRepository.setPosSettings(db, store.id, settings);

  return { status: 200, body: settings };
}
