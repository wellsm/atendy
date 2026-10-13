import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { StoreRepository } from '../../stores/repository';
import { RouterType } from '../../stores/types';

const { STORE_ID, ROUTER } = process.env;

if (!STORE_ID || (ROUTER !== RouterType.Jev && ROUTER !== RouterType.Llm)) {
  throw new Error('Set STORE_ID and ROUTER=jev|llm');
}

const db = DatabaseRunner.getClient<Db>('db');

await StoreRepository.setRouter(db, STORE_ID, ROUTER);

process.stdout.write(`Store ${STORE_ID} router=${ROUTER}\n`);
