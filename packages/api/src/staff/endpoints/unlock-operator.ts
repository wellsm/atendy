import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PanelStaffProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';

import { requireStore } from '../../panel/store';
import { StaffError } from '../errors';
import { withStaffErrors } from '../http-errors';
import { StaffRepository } from '../repository';
import { signOperator } from '../tokens';
import { StaffRole } from '../types';

export declare class UnlockOperatorRequest implements Http.Request {
  identity: PanelIdentity;
  body: {
    staffId: String.UUID;
    pin: string;
  };
}

export declare class UnlockOperatorResponse implements Http.Response {
  status: 200;
  body: {
    operatorToken: string;
    operator: {
      id: string;
      name: string;
      role: StaffRole;
    };
  };
}

/**
 * "Quem está usando?": a right PIN makes the employee the operator (the web sends the token as `x-operator`).
 */
export async function unlockOperatorHandler(
  request: Http.Incoming<UnlockOperatorRequest>,
  { db }: Service.Context<PanelStaffProvider>
): Promise<UnlockOperatorResponse> {
  const store = await requireStore(db, request.identity);
  const { staffId, pin } = request.body;

  const member = await withStaffErrors(async () => {
    // A courier has no PIN: say so instead of "wrong PIN".
    if ((await StaffRepository.findActive(db, store.id, staffId))?.role === StaffRole.Courier) {
      throw new StaffError('role', 'Couriers have no PIN.');
    }

    return StaffRepository.checkPin(db, store.id, staffId, pin);
  });

  const operatorToken = signOperator({
    storeId: store.id,
    staffId: member.id,
    role: member.role,
    version: member.pinVersion
  });

  return {
    status: 200,
    body: { operatorToken, operator: { id: member.id, name: member.name, role: member.role } }
  };
}
