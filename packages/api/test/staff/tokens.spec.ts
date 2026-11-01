import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { Permission } from '../../src/staff/permissions';
import { signApproval, signOperator, verifyApproval, verifyOperator } from '../../src/staff/tokens';
import { StaffRole } from '../../src/staff/types';

describe('staff tokens', () => {
  const operator = { storeId: 'store_1', staffId: 'staff_1', role: StaffRole.Cashier, version: 2 };
  const approval = { storeId: 'store_1', staffId: 'staff_2', permission: Permission.PosCancel };

  afterEach(() => mock.restoreAll());

  it('round-trips operator and approval claims with their lifetimes', () => {
    const now = Date.now();

    mock.method(Date, 'now', () => now);

    deepEqual(verifyOperator(signOperator(operator)), { ...operator, expiresAt: now + 12 * 60 * 60_000 });
    deepEqual(verifyApproval(signApproval(approval)), { ...approval, expiresAt: now + 2 * 60_000 });
  });

  it('rejects a tampered payload or signature', () => {
    const [payload, signature] = signOperator(operator).split('.');
    const forged = Buffer.from(JSON.stringify({ ...operator, role: StaffRole.Manager })).toString('base64url');

    equal(verifyOperator(`${forged}.${signature}`), undefined);
    equal(verifyOperator(`${payload}.${signature!.slice(0, -2)}AA`), undefined);
    equal(verifyOperator(payload), undefined);
    equal(verifyOperator(undefined), undefined);
  });

  it('rejects an expired token', () => {
    const issued = Date.now() - 13 * 60 * 60_000;

    mock.method(Date, 'now', () => issued);

    const token = signOperator(operator);
    const approvalToken = signApproval(approval);

    mock.restoreAll();

    equal(verifyOperator(token), undefined);
    equal(verifyApproval(approvalToken), undefined);
  });

  it('never verifies one kind as the other', () => {
    equal(verifyOperator(signApproval(approval)), undefined);
    equal(verifyApproval(signOperator(operator)), undefined);
  });
});
