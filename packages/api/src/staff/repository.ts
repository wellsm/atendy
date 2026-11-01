import type { DbClient } from '../db';
import type { StaffMember } from './types';

import { randomBytes, randomUUID } from 'node:crypto';

import { Order } from '@ez4/database';

import { StaffError } from './errors';
import { hashPin, verifyPin } from './pin';
import { StaffRole } from './types';
import { normalizePhone } from '../storefront/web-order';

type StaffRow = {
  id: string;
  name: string;
  role: StaffRole;
  delivers: boolean;
  phone?: string | null;
  active: boolean;
};

export type StaffInput = {
  name: string;
  role: string;
  delivers: boolean;
  phone: string | null;
  active: boolean;
  /**
   * Required for PIN roles when the employee has none yet; replaces the PIN when sent.
   */
  pin?: string | null;
};

const SELECT = { id: true, name: true, role: true, delivers: true, phone: true, active: true } as const;

const ROLES: string[] = [StaffRole.Cashier, StaffRole.Kitchen, StaffRole.Manager, StaffRole.Courier];

const PIN_PATTERN = /^\d{4}$/;

const MAX_NAME_LENGTH = 60;

const MAX_FAILED_PINS = 5;

const BLOCK_MS = 5 * 60 * 1000;

const toMember = (row: StaffRow): StaffMember => ({
  id: row.id,
  name: row.name,
  role: row.role,
  delivers: row.delivers,
  phone: row.phone ?? null,
  active: row.active
});

const validate = (input: StaffInput) => {
  const name = input.name.trim();

  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new StaffError('name', `The name must have 1 to ${MAX_NAME_LENGTH} characters.`);
  }

  if (!ROLES.includes(input.role)) {
    throw new StaffError('role', 'Unknown role.');
  }

  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;

  if (input.phone?.trim() && !phone) {
    throw new StaffError('phone', 'Invalid phone.');
  }

  if ((input.role === StaffRole.Courier || input.delivers) && !phone) {
    throw new StaffError('phone', 'Couriers and delivering employees need a phone.');
  }

  return { name, role: input.role as StaffRole, phone, delivers: input.delivers || input.role === StaffRole.Courier };
};

const requirePin = (pin: string) => {
  if (!PIN_PATTERN.test(pin)) {
    throw new StaffError('pin', 'The PIN must have 4 digits.');
  }
};

/**
 * Same lock as the cash module: staff writes of one store never interleave, so the manager rule holds.
 */
const lockStore = async (tx: DbClient, storeId: string) => {
  await tx.stores.findOne({ select: { id: true }, where: { id: storeId }, lock: true });
};

const isPinRole = (role: StaffRole) => role !== StaffRole.Courier;

/**
 * PIN employees need an active manager (so someone can reset PINs). `next` is the member as it will be saved.
 */
const assertManagerRule = async (
  tx: DbClient,
  storeId: string,
  next: { id: string; role: StaffRole; active: boolean }
) => {
  const { records } = await tx.staff.findMany({
    select: { id: true, role: true },
    where: { store_id: storeId, active: true }
  });

  const active = records.filter((row) => row.id !== next.id).map((row) => row.role);

  if (next.active) {
    active.push(next.role);
  }

  if (active.some((role) => isPinRole(role) && role !== StaffRole.Manager) && !active.includes(StaffRole.Manager)) {
    throw new StaffError('manager_required', 'An active manager is needed while other PIN employees exist.');
  }
};

const find = async (db: DbClient, storeId: string, staffId: string) => {
  const row = await db.staff.findOne({
    select: { ...SELECT, store_id: true, pin_version: true, pin_hash: true },
    where: { id: staffId }
  });

  if (!row || row.store_id !== storeId) {
    throw new StaffError('not_found', 'Employee not found.');
  }

  return row;
};

/**
 * A PIN role always has a PIN: `pin` is required unless the employee already has one (`hasPin`).
 */
const pinHashFor = async (role: StaffRole, pin: string | null | undefined, hasPin: boolean) => {
  if (!isPinRole(role)) {
    return undefined;
  }

  if (pin == null) {
    if (hasPin) {
      return undefined;
    }

    throw new StaffError('pin', 'PIN employees need a 4-digit PIN.');
  }

  requirePin(pin);

  return hashPin(pin);
};

export namespace StaffRepository {
  /**
   * Every employee, inactive ones included (screens resolve author names from them).
   */
  export const list = async (db: DbClient, storeId: string) => {
    const { records } = await db.staff.findMany({
      select: SELECT,
      where: { store_id: storeId },
      order: { name: Order.Asc }
    });

    return records.map(toMember);
  };

  export const create = async (db: DbClient, storeId: string, input: Omit<StaffInput, 'active'>) => {
    const data = validate({ ...input, active: true });
    const pinHash = await pinHashFor(data.role, input.pin, false);

    return db.transaction(async (tx) => {
      await lockStore(tx, storeId);

      const id = randomUUID();
      const now = new Date().toISOString();

      await assertManagerRule(tx, storeId, { id, role: data.role, active: true });

      const row = { id, store_id: storeId, ...data, pin_version: 0, failed_pins: 0, active: true };

      await tx.staff.insertOne({ data: { ...row, pin_hash: pinHash, created_at: now, updated_at: now } });

      return toMember(row);
    });
  };

  export const update = async (db: DbClient, storeId: string, staffId: string, input: StaffInput) => {
    const data = validate(input);

    return db.transaction(async (tx) => {
      await lockStore(tx, storeId);

      const current = await find(tx, storeId, staffId);
      // Deactivation drops the PIN, so reactivating a PIN role needs a new one; an inactive employee needs none.
      const pinHash = input.active
        ? await pinHashFor(
            data.role,
            input.pin,
            current.active && current.role !== StaffRole.Courier && !!current.pin_hash
          )
        : undefined;

      await assertManagerRule(tx, storeId, { id: staffId, role: data.role, active: input.active });

      // The PIN of a courier makes no sense: drop it when the role changes to courier.
      const toCourier = data.role === StaffRole.Courier;
      const deactivated = current.active && !input.active;
      const newPin = pinHash !== undefined;

      await tx.staff.updateOne({
        data: {
          ...data,
          active: input.active,
          ...(toCourier || !input.active ? { pin_hash: null } : {}),
          ...(newPin ? { pin_hash: pinHash, failed_pins: 0, blocked_until: null } : {}),
          // The courier link belongs to active couriers and employees who deliver.
          ...((toCourier || data.delivers) && input.active ? {} : { courier_token: null }),
          ...(deactivated || toCourier || newPin ? { pin_version: current.pin_version + 1 } : {}),
          updated_at: new Date().toISOString()
        },
        where: { id: staffId }
      });

      return toMember({ ...data, id: staffId, active: input.active });
    });
  };

  export const setPin = async (db: DbClient, storeId: string, staffId: string, pin: string) => {
    requirePin(pin);

    const pinHash = await hashPin(pin);

    await db.transaction(async (tx) => {
      const locked = await tx.staff.findOne({
        select: { store_id: true, role: true, pin_version: true },
        where: { id: staffId },
        lock: true
      });

      if (!locked || locked.store_id !== storeId) {
        throw new StaffError('not_found', 'Employee not found.');
      }

      if (locked.role === StaffRole.Courier) {
        throw new StaffError('role', 'Couriers have no PIN.');
      }

      await tx.staff.updateOne({
        data: {
          pin_hash: pinHash,
          pin_version: locked.pin_version + 1,
          failed_pins: 0,
          blocked_until: null,
          updated_at: new Date().toISOString()
        },
        where: { id: staffId }
      });
    });
  };

  /**
   * Verifies an active employee's PIN under a row lock, so parallel guesses all count. A wrong PIN is recorded and
   * thrown after the transaction (a throw inside would roll the counter back).
   */
  export const checkPin = async (db: DbClient, storeId: string, staffId: string, pin: string) => {
    const outcome = await db.transaction(async (tx) => {
      const row = await tx.staff.findOne({
        select: {
          ...SELECT,
          store_id: true,
          pin_hash: true,
          failed_pins: true,
          blocked_until: true,
          pin_version: true
        },
        where: { id: staffId },
        lock: true
      });

      if (!row || row.store_id !== storeId || !row.active || !row.pin_hash) {
        return 'pin';
      }

      const now = Date.now();
      const blockedUntil = row.blocked_until ? Date.parse(row.blocked_until) : 0;

      if (blockedUntil > now) {
        return 'blocked';
      }

      // An expired block starts a fresh count.
      const failed = blockedUntil ? 0 : row.failed_pins;

      if (await verifyPin(pin, row.pin_hash)) {
        if (row.failed_pins || row.blocked_until) {
          await tx.staff.updateOne({ data: { failed_pins: 0, blocked_until: null }, where: { id: staffId } });
        }

        return { ...toMember(row), pinVersion: row.pin_version };
      }

      const next = failed + 1;

      await tx.staff.updateOne({
        data: {
          failed_pins: next,
          blocked_until: next >= MAX_FAILED_PINS ? new Date(now + BLOCK_MS).toISOString() : null
        },
        where: { id: staffId }
      });

      return 'pin';
    });

    if (outcome === 'blocked') {
      throw new StaffError('blocked', 'Too many wrong PINs; try again in a few minutes.');
    }

    if (outcome === 'pin') {
      throw new StaffError('pin', 'Wrong PIN.');
    }

    return outcome;
  };

  /**
   * The panel is locked while the store has an active employee with a PIN role and a PIN.
   */
  export const isLocked = async (db: DbClient, storeId: string) => {
    const { records } = await db.staff.findMany({
      select: { role: true, pin_hash: true },
      where: { store_id: storeId, active: true }
    });

    return records.some((row) => isPinRole(row.role) && !!row.pin_hash);
  };

  /**
   * `pinVersion` lets `authorize` drop operator tokens issued before a PIN change.
   */
  export const findActive = async (db: DbClient, storeId: string, staffId: string) => {
    const row = await db.staff.findOne({
      select: { ...SELECT, store_id: true, pin_version: true },
      where: { id: staffId }
    });

    return row && row.store_id === storeId && row.active
      ? { ...toMember(row), pinVersion: row.pin_version }
      : undefined;
  };

  /**
   * A new random link token; the previous one stops working. Returned once, never listed.
   */
  export const regenerateCourierToken = async (db: DbClient, storeId: string, staffId: string) => {
    const current = await find(db, storeId, staffId);

    if (current.role !== StaffRole.Courier && !current.delivers) {
      throw new StaffError('role', 'Only couriers and delivering employees have a link.');
    }

    const token = randomBytes(32).toString('base64url');

    await db.staff.updateOne({
      data: { courier_token: token, updated_at: new Date().toISOString() },
      where: { id: staffId }
    });

    return token;
  };

  export const findCourierByToken = async (db: DbClient, token: string) => {
    const row = await db.staff.findOne({
      select: { ...SELECT, store_id: true },
      where: { courier_token: token }
    });

    return row?.active && (row.role === StaffRole.Courier || row.delivers)
      ? { ...toMember(row), storeId: row.store_id }
      : undefined;
  };
}
