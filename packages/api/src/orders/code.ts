import type { DbClient } from '../db';

import { randomInt } from 'node:crypto';

import { OrderCodeMode } from '../stores/types';

/**
 * Upper case letters and digits without the look-alikes 0/O, 1/I/L: 31 symbols (31^6 ≈ 887 million codes), read aloud or typed without doubt.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const RANDOM_LENGTH = 6;

const RANDOM_TRIES = 5;

const randomCode = () => Array.from({ length: RANDOM_LENGTH }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');

/**
 * Code shown to the store and the customer (`#K7Q2MX` or `#128`). Orders placed before codes existed show the start
 * of their id, upper case.
 */
export const displayOrderCode = (order: { id: string; code?: string | null }) =>
  order.code ?? order.id.slice(0, 4).toUpperCase();

const randomFreeCode = async (db: DbClient, storeId: string) => {
  for (let attempt = 0; attempt < RANDOM_TRIES; attempt++) {
    const code = randomCode();

    if (!(await db.orders.count({ where: { store_id: storeId, code } }))) {
      return code;
    }
  }

  throw new Error('Could not find a free order code');
};

/**
 * The next code of the store, by its mode, inside the caller's transaction: sequential from 1 (the store row is locked
 * until `tx` ends, so two placements never get the same number and a rolled back placement gives its number back) or
 * 6 random symbols, unique in the store.
 */
export const nextOrderCodeIn = async (tx: DbClient, storeId: string) => {
  const store = await tx.stores.findOne({ select: { order_code_mode: true }, where: { id: storeId } });

  if (store?.order_code_mode === OrderCodeMode.Sequential) {
    const locked = await tx.stores.findOne({ select: { order_seq: true }, where: { id: storeId }, lock: true });
    const next = (locked?.order_seq ?? 0) + 1;

    await tx.stores.updateOne({ data: { order_seq: next }, where: { id: storeId } });

    return String(next);
  }

  return randomFreeCode(tx, storeId);
};

/**
 * `nextOrderCodeIn` on its own: sequential mode opens a transaction for the store row lock.
 */
export const nextOrderCode = async (db: DbClient, storeId: string) => {
  const store = await db.stores.findOne({ select: { order_code_mode: true }, where: { id: storeId } });

  if (store?.order_code_mode === OrderCodeMode.Sequential) {
    return db.transaction((tx) => nextOrderCodeIn(tx, storeId));
  }

  return randomFreeCode(db, storeId);
};
