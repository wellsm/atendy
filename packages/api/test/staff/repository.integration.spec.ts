import type { Db } from '../../src/db';

import { equal, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseTester } from '@ez4/local-database/test';

import { StaffError } from '../../src/staff/errors';
import { StaffRepository } from '../../src/staff/repository';
import { StaffRole } from '../../src/staff/types';
import { seedStore } from '../support/fixtures';

describe('StaffRepository', () => {
  const db = DatabaseTester.getClient<Db>('Db');

  const field = (name: string) => (error: unknown) => error instanceof StaffError && error.field === name;

  const person = (role: StaffRole, extra: { delivers?: boolean; phone?: string | null; pin?: string } = {}) => ({
    name: role,
    role,
    delivers: false,
    phone: null,
    ...(role === StaffRole.Courier ? {} : { pin: '1234' }),
    ...extra
  });

  const withManagerAndCashier = async () => {
    const { storeId } = await seedStore(db);
    const manager = await StaffRepository.create(db, storeId, person(StaffRole.Manager));
    const cashier = await StaffRepository.create(db, storeId, person(StaffRole.Cashier));

    return { storeId, manager, cashier };
  };

  const withPin = async (pin = '1234') => {
    const { storeId, cashier, manager } = await withManagerAndCashier();

    await StaffRepository.setPin(db, storeId, cashier.id, pin);

    return { storeId, cashier, manager };
  };

  it('refuses a cashier before a manager exists', async () => {
    const { storeId } = await seedStore(db);

    await rejects(StaffRepository.create(db, storeId, person(StaffRole.Cashier)), field('manager_required'));
    equal((await StaffRepository.list(db, storeId)).length, 0);
  });

  it('refuses deactivating or demoting the last manager while a cashier is active', async () => {
    const { storeId, manager, cashier } = await withManagerAndCashier();
    const as = (role: StaffRole, active: boolean) => ({ ...person(role), active });

    await rejects(
      StaffRepository.update(db, storeId, manager.id, as(StaffRole.Manager, false)),
      field('manager_required')
    );
    await rejects(
      StaffRepository.update(db, storeId, manager.id, as(StaffRole.Cashier, true)),
      field('manager_required')
    );

    await StaffRepository.update(db, storeId, cashier.id, as(StaffRole.Cashier, false));
    await StaffRepository.update(db, storeId, manager.id, as(StaffRole.Manager, false));
  });

  it('a courier needs a phone and never gets a PIN', async () => {
    const { storeId } = await seedStore(db);

    await rejects(StaffRepository.create(db, storeId, person(StaffRole.Courier)), field('phone'));
    await rejects(StaffRepository.create(db, storeId, person(StaffRole.Manager, { delivers: true })), field('phone'));

    const courier = await StaffRepository.create(db, storeId, person(StaffRole.Courier, { phone: '(11) 98888-7777' }));

    equal(courier.phone, '5511988887777');
    await rejects(StaffRepository.setPin(db, storeId, courier.id, '1234'), field('role'));
  });

  it('isLocked is false with only couriers and true with an active cashier', async () => {
    const { storeId } = await seedStore(db);

    await StaffRepository.create(db, storeId, person(StaffRole.Courier, { phone: '11988887777' }));
    equal(await StaffRepository.isLocked(db, storeId), false);

    await StaffRepository.create(db, storeId, person(StaffRole.Manager));
    equal(await StaffRepository.isLocked(db, storeId), true);
  });

  it('blocks after 5 wrong PINs for 5 minutes', async () => {
    const { storeId, cashier } = await withPin();

    for (let attempt = 0; attempt < 5; attempt++) {
      await rejects(StaffRepository.checkPin(db, storeId, cashier.id, '0000'), field('pin'));
    }

    await rejects(StaffRepository.checkPin(db, storeId, cashier.id, '1234'), field('blocked'));

    await db.staff.updateOne({
      data: { blocked_until: new Date(Date.now() - 1000).toISOString() },
      where: { id: cashier.id }
    });

    equal((await StaffRepository.checkPin(db, storeId, cashier.id, '1234')).id, cashier.id);

    const row = await db.staff.findOne({
      select: { failed_pins: true, blocked_until: true },
      where: { id: cashier.id }
    });

    equal(row?.failed_pins, 0);
    equal(row?.blocked_until ?? null, null);
  });

  it('parallel wrong PINs never exceed 5 attempts', async () => {
    const { storeId, cashier } = await withPin();

    await Promise.allSettled(
      Array.from({ length: 8 }, () => StaffRepository.checkPin(db, storeId, cashier.id, '0000'))
    );

    const row = await db.staff.findOne({
      select: { failed_pins: true, blocked_until: true },
      where: { id: cashier.id }
    });

    ok((row?.failed_pins ?? 99) <= 5);
    ok(row?.blocked_until);
  });

  it('PIN must be 4 digits', async () => {
    const { storeId, cashier } = await withManagerAndCashier();

    await rejects(StaffRepository.setPin(db, storeId, cashier.id, '123'), field('pin'));
    await rejects(StaffRepository.setPin(db, storeId, cashier.id, '12a4'), field('pin'));
  });

  it('a PIN role needs a PIN, and isLocked ignores a PIN role without one', async () => {
    const { storeId } = await seedStore(db);

    await rejects(StaffRepository.create(db, storeId, { ...person(StaffRole.Manager), pin: undefined }), field('pin'));
    await rejects(StaffRepository.create(db, storeId, person(StaffRole.Manager, { pin: '12' })), field('pin'));

    const manager = await StaffRepository.create(db, storeId, person(StaffRole.Manager));

    equal(await StaffRepository.isLocked(db, storeId), true);

    await db.staff.updateOne({ data: { pin_hash: null }, where: { id: manager.id } });
    equal(await StaffRepository.isLocked(db, storeId), false);
  });

  it('turning a courier into a PIN role requires a PIN', async () => {
    const { storeId } = await seedStore(db);
    const courier = await StaffRepository.create(db, storeId, person(StaffRole.Courier, { phone: '11988887777' }));
    const toManager = { ...person(StaffRole.Manager), active: true };

    await rejects(StaffRepository.update(db, storeId, courier.id, { ...toManager, pin: undefined }), field('pin'));
    await StaffRepository.update(db, storeId, courier.id, toManager);
    equal((await StaffRepository.checkPin(db, storeId, courier.id, '1234')).id, courier.id);
  });

  it('the courier link follows courier or delivers, and dies with the role change', async () => {
    const { storeId } = await seedStore(db);
    const phone = '11988887777';
    const courier = await StaffRepository.create(db, storeId, person(StaffRole.Courier, { phone }));
    const token = await StaffRepository.regenerateCourierToken(db, storeId, courier.id);

    equal((await StaffRepository.findCourierByToken(db, token))?.id, courier.id);

    await StaffRepository.update(db, storeId, courier.id, { ...person(StaffRole.Manager), active: true });
    equal(await StaffRepository.findCourierByToken(db, token), undefined);

    await StaffRepository.update(db, storeId, courier.id, {
      ...person(StaffRole.Manager, { delivers: true, phone }),
      active: true
    });

    const second = await StaffRepository.regenerateCourierToken(db, storeId, courier.id);

    equal((await StaffRepository.findCourierByToken(db, second))?.id, courier.id);

    await StaffRepository.update(db, storeId, courier.id, { ...person(StaffRole.Manager, { phone }), active: true });
    equal(await StaffRepository.findCourierByToken(db, second), undefined);
  });

  it('PIN change and deactivation both bump pin_version', async () => {
    const { storeId, cashier } = await withPin();
    const version = async () =>
      (await db.staff.findOne({ select: { pin_version: true }, where: { id: cashier.id } }))!.pin_version;

    const beforePin = await version();

    await StaffRepository.setPin(db, storeId, cashier.id, '9999');

    const afterPin = await version();

    equal(afterPin, beforePin + 1);

    await StaffRepository.update(db, storeId, cashier.id, { ...person(StaffRole.Cashier), active: false });

    equal(await version(), afterPin + 1);
    equal(await StaffRepository.findActive(db, storeId, cashier.id), undefined);
  });

  it('deactivation drops the PIN and the courier link; reactivation needs a new PIN', async () => {
    const { storeId, cashier } = await withPin();
    const phone = '11988887777';
    const deliverer = { ...person(StaffRole.Cashier, { delivers: true, phone }), active: true };

    await StaffRepository.update(db, storeId, cashier.id, deliverer);

    const token = await StaffRepository.regenerateCourierToken(db, storeId, cashier.id);

    await StaffRepository.update(db, storeId, cashier.id, { ...deliverer, pin: undefined, active: false });

    const row = await db.staff.findOne({ select: { pin_hash: true, courier_token: true }, where: { id: cashier.id } });

    equal(row?.pin_hash, null);
    equal(row?.courier_token, null);
    equal(await StaffRepository.findCourierByToken(db, token), undefined);

    // Editing while inactive needs no PIN.
    await StaffRepository.update(db, storeId, cashier.id, {
      ...deliverer,
      name: 'Caixa',
      pin: undefined,
      active: false
    });

    await rejects(
      StaffRepository.update(db, storeId, cashier.id, { ...deliverer, pin: undefined, active: true }),
      field('pin')
    );

    await StaffRepository.update(db, storeId, cashier.id, { ...deliverer, pin: '4321', active: true });
    equal((await StaffRepository.checkPin(db, storeId, cashier.id, '4321')).id, cashier.id);
  });

  it('does not touch another store`s employee', async () => {
    const { cashier } = await withManagerAndCashier();
    const other = await seedStore(db);

    await rejects(StaffRepository.setPin(db, other.storeId, cashier.id, '1234'), field('not_found'));
    await rejects(StaffRepository.checkPin(db, other.storeId, cashier.id, '1234'), field('pin'));
  });
});
