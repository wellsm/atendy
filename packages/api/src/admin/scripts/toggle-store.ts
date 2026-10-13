import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { StoreRepository } from '../../stores/repository';

const { STORE_ID, ACCEPTING } = process.env;

if (!STORE_ID || (ACCEPTING !== 'true' && ACCEPTING !== 'false')) {
  throw new Error('Set STORE_ID and ACCEPTING=true|false');
}

const db = DatabaseRunner.getClient<Db>('db');

await StoreRepository.setAcceptingOrders(db, STORE_ID, ACCEPTING === 'true');

process.stdout.write(`Store ${STORE_ID} accepting_orders=${ACCEPTING}\n`);
