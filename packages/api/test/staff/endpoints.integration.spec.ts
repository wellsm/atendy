import type { Db } from '../../src/db';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { HttpBadRequestError, HttpConflictError } from '@ez4/gateway';
import { DatabaseTester } from '@ez4/local-database/test';

import { createStaffHandler } from '../../src/staff/endpoints/create-staff';
import { listStaffHandler } from '../../src/staff/endpoints/list-staff';
import { regenerateCourierLinkHandler } from '../../src/staff/endpoints/regenerate-courier-link';
import { setStaffPinHandler } from '../../src/staff/endpoints/set-staff-pin';
import { updateStaffHandler } from '../../src/staff/endpoints/update-staff';
import { StaffRepository } from '../../src/staff/repository';
import { StaffRole } from '../../src/staff/types';
import { seedStore } from '../support/fixtures';
import { operatorHeaders } from '../support/staff';

describe('panel staff endpoints', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const setup = async () => {
    const orgId = `org_${randomUUID()}`;
    const { storeId } = await seedStore(db);

    await db.stores.updateOne({ data: { clerk_org_id: orgId }, where: { id: storeId } });

    // Once an employee has a PIN the store is locked: the owner acts after Clerk reverification (no staff id).
    const headers = operatorHeaders({ storeId, staffId: null, userId: 'user_1', role: StaffRole.Manager, version: 0 });

    return { storeId, headers, identity: { userId: 'user_1', orgId } };
  };

  const create = async (identity: object, body: object, headers?: object) =>
    (await createStaffHandler({ identity, headers, body } as never, { db })).body.staff;

  it('creates, updates and lists employees without secrets, inactive ones included', async () => {
    const { identity, headers } = await setup();

    const manager = await create(identity, { name: 'Ana', role: 'manager', delivers: false, phone: null, pin: '1111' });
    const cashier = await create(
      identity,
      { name: 'Bia', role: 'cashier', delivers: false, phone: null, pin: '2222' },
      headers
    );

    await setStaffPinHandler(
      { identity, headers, parameters: { staffId: cashier.id }, body: { pin: '4321' } } as never,
      { db }
    );

    const updated = await updateStaffHandler(
      {
        identity,
        headers,
        parameters: { staffId: cashier.id },
        body: { name: 'Bia M.', role: 'cashier', delivers: true, phone: '11 98888-7777', active: false }
      } as never,
      { db }
    );

    deepEqual(updated.body.staff, {
      id: cashier.id,
      name: 'Bia M.',
      role: 'cashier',
      delivers: true,
      phone: '5511988887777',
      active: false
    });

    const { staff } = (await listStaffHandler({ identity } as never, { db })).body;

    deepEqual(
      staff.map((member) => member.id),
      [manager.id, cashier.id]
    );

    for (const member of staff) {
      for (const secret of ['pin_hash', 'pinHash', 'courier_token', 'courierToken', 'failed_pins', 'failedPins']) {
        ok(!(secret in member));
      }
    }
  });

  it('answers 409 for the manager rule and 400 for bad input', async () => {
    const { identity } = await setup();

    await rejects(
      createStaffHandler(
        { identity, body: { name: 'Bia', role: 'cashier', delivers: false, phone: null, pin: '2222' } } as never,
        {
          db
        }
      ),
      (error: unknown) => error instanceof HttpConflictError && error.context?.field === 'manager_required'
    );

    await rejects(
      createStaffHandler({ identity, body: { name: 'Zé', role: 'courier', delivers: true, phone: null } } as never, {
        db
      }),
      (error: unknown) => error instanceof HttpBadRequestError && error.context?.field === 'phone'
    );
  });

  it('returns the courier link token once and a new one revokes the old', async () => {
    const { identity, storeId } = await setup();
    const courier = await create(identity, { name: 'Zé', role: 'courier', delivers: true, phone: '11988887777' });
    const regenerate = async () =>
      (await regenerateCourierLinkHandler({ identity, parameters: { staffId: courier.id } } as never, { db })).body
        .token;

    const first = await regenerate();
    const second = await regenerate();

    ok(first.length >= 43);
    ok(first !== second);
    equal(await StaffRepository.findCourierByToken(db, first), undefined);
    equal((await StaffRepository.findCourierByToken(db, second))?.id, courier.id);
    equal((await StaffRepository.findCourierByToken(db, second))?.storeId, storeId);
  });
});
