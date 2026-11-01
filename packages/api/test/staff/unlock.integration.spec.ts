import type { HttpError } from '@ez4/gateway';
import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { listAdminStaffHandler } from '../../src/admin/endpoints/list-staff';
import { resetAdminStaffPinHandler } from '../../src/admin/endpoints/reset-staff-pin';
import { approveStaffActionHandler } from '../../src/staff/endpoints/approve-action';
import { getStaffLockHandler } from '../../src/staff/endpoints/get-staff-lock';
import { unlockOperatorHandler } from '../../src/staff/endpoints/unlock-operator';
import { unlockOwnerHandler } from '../../src/staff/endpoints/unlock-owner';
import { Permission } from '../../src/staff/permissions';
import { StaffRepository } from '../../src/staff/repository';
import { verifyApproval, verifyOperator } from '../../src/staff/tokens';
import { StaffRole } from '../../src/staff/types';
import { seedStore } from '../support/fixtures';

describe('staff unlock endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const person = (role: StaffRole, pin = '1234') => ({ name: role, role, delivers: false, phone: null, pin });

  const fails = (status: number, field: string) => (error: HttpError) => {
    equal(error.status, status);
    equal(error.context?.field, field);
    return true;
  };

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    const manager = await StaffRepository.create(db, storeId, person(StaffRole.Manager, '1111'));
    const cashier = await StaffRepository.create(db, storeId, person(StaffRole.Cashier, '2222'));
    const courier = await StaffRepository.create(db, storeId, {
      name: 'Moto',
      role: StaffRole.Courier,
      delivers: true,
      phone: '11999998888'
    });

    return { storeId, identity: { userId: 'user_1', orgId }, manager, cashier, courier };
  };

  const unlock = (identity: object, staffId: string, pin: string) =>
    unlockOperatorHandler({ identity, body: { staffId, pin } } as never, { db });

  it('lists the PIN employees of a locked store', async () => {
    const { identity, storeId, manager, cashier } = await setup();

    await StaffRepository.update(db, storeId, cashier.id, { ...person(StaffRole.Cashier), pin: null, active: false });

    const { body } = await getStaffLockHandler({ identity } as never, { db });

    deepEqual(body, {
      locked: true,
      idleMinutes: 15,
      staff: [{ id: manager.id, name: manager.name, role: StaffRole.Manager }]
    });
  });

  it('unlocks with the right PIN only, never a courier', async () => {
    const { identity, storeId, cashier, courier } = await setup();

    await rejects(unlock(identity, cashier.id, '9999'), fails(400, 'pin'));
    await rejects(unlock(identity, courier.id, '0000'), fails(400, 'role'));

    const { body } = await unlock(identity, cashier.id, '2222');

    deepEqual(body.operator, { id: cashier.id, name: cashier.name, role: StaffRole.Cashier });
    deepEqual(
      { ...verifyOperator(body.operatorToken), expiresAt: 0 },
      { storeId, staffId: cashier.id, role: StaffRole.Cashier, version: 0, expiresAt: 0 }
    );
  });

  it('issues an approval only for a manager', async () => {
    const { identity, storeId, manager, cashier } = await setup();

    const approve = (staffId: string, pin: string, permission = Permission.PosCancel) =>
      approveStaffActionHandler({ identity, body: { staffId, pin, permission } } as never, { db });

    await rejects(approve(cashier.id, '2222'), fails(403, 'role'));
    await rejects(approve(manager.id, '0000'), fails(400, 'pin'));
    await rejects(approve(manager.id, '1111', Permission.MenuEdit), fails(400, 'permission'));

    const { body } = await approve(manager.id, '1111');
    const claims = verifyApproval(body.approvalToken);

    equal(claims?.storeId, storeId);
    equal(claims?.staffId, manager.id);
    equal(claims?.permission, Permission.PosCancel);
  });

  it('unlocks the owner as manager only after a recent reverification', async () => {
    const { identity, storeId } = await setup();

    await rejects(
      unlockOwnerHandler({ identity: { ...identity, factorAgeMinutes: 30 } } as never, { db }),
      fails(403, 'reverify')
    );

    await rejects(
      unlockOwnerHandler({ identity: { ...identity, factorAgeMinutes: 3 } } as never, { db }),
      fails(403, 'reverify')
    );

    await rejects(unlockOwnerHandler({ identity } as never, { db }), fails(403, 'reverify'));

    const { body } = await unlockOwnerHandler({ identity: { ...identity, factorAgeMinutes: 2 } } as never, { db });
    const claims = verifyOperator(body.operatorToken);

    equal(claims?.storeId, storeId);
    equal(claims?.staffId, null);
    equal(claims?.role, StaffRole.Manager);
    equal(claims?.userId, 'user_1');
  });

  it('lists the store employees for the admin', async () => {
    const { storeId, cashier } = await setup();

    const { body } = await listAdminStaffHandler({ identity: { userId: 'admin' }, parameters: { storeId } } as never, {
      db
    });

    equal(body.staff.length, 3);
    deepEqual(Object.keys(body.staff.find(({ id }) => id === cashier.id)!).sort(), ['active', 'id', 'name', 'role']);
  });

  it('lets the admin reset a PIN that then unlocks', async () => {
    const { identity, storeId, cashier } = await setup();

    await resetAdminStaffPinHandler(
      { identity: { userId: 'admin' }, parameters: { storeId, staffId: cashier.id }, body: { pin: '4321' } } as never,
      { db }
    );

    await rejects(unlock(identity, cashier.id, '2222'), fails(400, 'pin'));
    ok((await unlock(identity, cashier.id, '4321')).body.operatorToken);
  });
});
