import type { DiscountGuard } from './repository';
import type { DbClient } from '../db';
import type { PanelIdentity } from '../panel/types';
import type { OperatorHeaders } from '../staff/authorize';

import { authorize } from '../staff/authorize';
import { Permission } from '../staff/permissions';
import { StoreRepository } from '../stores/repository';

/**
 * Past the store's discount limit the write needs `PosDiscountOverLimit` (a manager or a manager's approval).
 */
export const posDiscountGuard =
  (db: DbClient, store: { id: string }, identity: PanelIdentity, headers: OperatorHeaders | undefined): DiscountGuard =>
  async (discountCents, subtotalCents) => {
    const { discountLimitPercent } = await StoreRepository.getStaffSettings(db, store.id);

    if (discountCents * 100 > subtotalCents * discountLimitPercent) {
      await authorize(db, store, identity, headers, Permission.PosDiscountOverLimit);
    }
  };
