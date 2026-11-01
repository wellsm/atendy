import type { Db } from '../../src/db';
import type { OperatorHeaders } from '../../src/staff/authorize';

import { deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpForbiddenError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { authorize } from '../../src/staff/authorize';
import { Permission } from '../../src/staff/permissions';
import { StaffRepository } from '../../src/staff/repository';
import { signApproval } from '../../src/staff/tokens';
import { StaffRole } from '../../src/staff/types';
import { seedStore } from '../support/fixtures';
import { operatorHeaders } from '../support/staff';

describe('authorize', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const clerk = { userId: 'user_owner', orgId: 'org_1' };

  const refused = (field: string) => (error: unknown) =>
    error instanceof HttpForbiddenError && error.context?.field === field;

  const person = (role: StaffRole, pin = '1234') => ({ name: role, role, delivers: false, phone: null, pin });

  const lockedStore = async () => {
    const { storeId } = await seedStore(db);
    const manager = await StaffRepository.create(db, storeId, person(StaffRole.Manager));
    const cashier = await StaffRepository.create(db, storeId, person(StaffRole.Cashier));
    const kitchen = await StaffRepository.create(db, storeId, person(StaffRole.Kitchen));

    const as = (staff: { id: string; role: StaffRole }, version = 0) =>
      operatorHeaders({ storeId, staffId: staff.id, role: staff.role, version });

    const run = (headers: OperatorHeaders | undefined, permission: Permission) =>
      authorize(db, { id: storeId }, clerk, headers, permission);

    return { storeId, manager, cashier, kitchen, as, run };
  };

  it('returns the Clerk user on an unlocked store', async () => {
    const { storeId } = await seedStore(db);

    await StaffRepository.create(db, storeId, {
      name: 'Moto',
      role: StaffRole.Courier,
      delivers: true,
      phone: '11999998888'
    });

    deepEqual(await authorize(db, { id: storeId }, clerk, undefined, Permission.Settings), { author: 'user_owner' });
  });

  it('asks for an operator on a locked store; invalid or foreign tokens count as none', async () => {
    const { storeId, cashier, as, run } = await lockedStore();
    const other = await seedStore(db);
    const valid = as(cashier)['x-operator']!;

    await rejects(run(undefined, Permission.PosSell), refused('operator_required'));
    await rejects(run({}, Permission.PosSell), refused('operator_required'));
    await rejects(run({ 'x-operator': `${valid}x` }, Permission.PosSell), refused('operator_required'));

    const approvalAsOperator = signApproval({ storeId, staffId: cashier.id, permission: Permission.PosSell });

    await rejects(run({ 'x-operator': approvalAsOperator }, Permission.PosSell), refused('operator_required'));

    const foreign = operatorHeaders({
      storeId: other.storeId,
      staffId: cashier.id,
      role: StaffRole.Cashier,
      version: 0
    });

    await rejects(run(foreign, Permission.PosSell), refused('operator_required'));
  });

  it('checks the role: forbidden, approval required, allowed', async () => {
    const { cashier, kitchen, as, run } = await lockedStore();

    deepEqual(await run(as(cashier), Permission.PosSell), { author: cashier.id });
    deepEqual(await run(as(kitchen), Permission.OrdersBoard), { author: kitchen.id });
    await rejects(run(as(cashier), Permission.MenuEdit), refused('forbidden'));
    await rejects(run(as(cashier), Permission.PosCancel), refused('approval_required'));
  });

  it('accepts a manager approval for that permission only', async () => {
    const { storeId, manager, cashier, kitchen, run } = await lockedStore();

    const approved = (staffId: string, permission: Permission) =>
      operatorHeaders(
        { storeId, staffId: cashier.id, role: StaffRole.Cashier, version: 0 },
        { storeId, staffId, permission }
      );

    deepEqual(await run(approved(manager.id, Permission.PosCancel), Permission.PosCancel), { author: manager.id });

    await rejects(run(approved(manager.id, Permission.CashClose), Permission.PosCancel), refused('approval_required'));

    // An approval signed for a non-manager (or a non-approvable permission) never counts.
    await rejects(run(approved(kitchen.id, Permission.PosCancel), Permission.PosCancel), refused('approval_required'));
    await rejects(run(approved(manager.id, Permission.MenuEdit), Permission.MenuEdit), refused('forbidden'));

    // A tampered approval counts as none.
    const tampered = { ...approved(manager.id, Permission.PosCancel) };

    tampered['x-approval'] = `${tampered['x-approval']}x`;

    await rejects(run(tampered, Permission.PosCancel), refused('approval_required'));
  });

  it('honors approvals only for a cashier operator', async () => {
    const { storeId, manager, kitchen, run } = await lockedStore();

    const kitchenApproved = operatorHeaders(
      { storeId, staffId: kitchen.id, role: StaffRole.Kitchen, version: 0 },
      { storeId, staffId: manager.id, permission: Permission.OrdersCancel }
    );

    await rejects(run(kitchenApproved, Permission.OrdersCancel), refused('forbidden'));
  });

  it('reads the role from the database, never from the token', async () => {
    const { storeId, as, run } = await lockedStore();
    const second = await StaffRepository.create(db, storeId, person(StaffRole.Manager));

    deepEqual(await run(as(second), Permission.MenuEdit), { author: second.id });

    await StaffRepository.update(db, storeId, second.id, { ...person(StaffRole.Cashier), pin: null, active: true });

    await rejects(run(as(second), Permission.MenuEdit), refused('forbidden'));
  });

  it('drops the token of a deactivated employee or one issued before a PIN change', async () => {
    const { storeId, cashier, kitchen, as, run } = await lockedStore();

    await StaffRepository.setPin(db, storeId, cashier.id, '9999');

    await rejects(run(as(cashier, 0), Permission.PosSell), refused('operator_required'));
    deepEqual(await run(as(cashier, 1), Permission.PosSell), { author: cashier.id });

    await StaffRepository.update(db, storeId, kitchen.id, { ...person(StaffRole.Kitchen), pin: null, active: false });

    // Deactivation bumps the version too; a token with the new one still fails on `active`.
    await rejects(run(as(kitchen, 0), Permission.OrdersBoard), refused('operator_required'));
    await rejects(run(as(kitchen, 1), Permission.OrdersBoard), refused('operator_required'));
  });

  it('lets the owner operator act as manager only for the Clerk user who reverified', async () => {
    const { storeId, run } = await lockedStore();

    const owner = (userId?: string) =>
      operatorHeaders({ storeId, staffId: null, userId, role: StaffRole.Manager, version: 0 });

    deepEqual(await run(owner('user_owner'), Permission.Settings), { author: 'user_owner' });
    await rejects(run(owner('user_other'), Permission.Settings), refused('operator_required'));
    await rejects(run(owner(), Permission.Settings), refused('operator_required'));
  });
});
